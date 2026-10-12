import { Queue, Worker, Job } from "bullmq";
import IORedis from "ioredis";
// Type-only, so this does not close a cycle at runtime: `billing-jobs` imports
// this module's queue, and the worker below needs its job shape.
import type { CancellationData, TrialNudgeData } from "./billing-jobs";

const connection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
  lazyConnect: true,
  // Fail fast when Redis is down: without this, commands buffer forever and
  // every request that enqueues hangs instead of answering 503.
  enableOfflineQueue: false,
});

/** Thrown when a job cannot be enqueued because Redis is unreachable. */
export class QueueUnavailableError extends Error {
  readonly status = 503;
  constructor() {
    super("job queue unavailable \u2014 Redis is unreachable; the work is saved, retry shortly");
  }
}

const CONNECTION_FAILURE = /connection is closed|connection is not open|connect econnrefused|connect etimedout|stream disconnected|loading/i;

/**
 * queues.X.add that throws QueueUnavailableError (instead of hanging or
 * leaking driver errors) when Redis is down. Genuine job errors propagate
 * untouched. API routes translate QueueUnavailableError to 503.
 */
export async function enqueue<T extends object>(
  queue: Queue,
  name: string,
  data: T,
  opts?: Parameters<Queue["add"]>[2],
): Promise<Job> {
  try {
    return await queue.add(name, data, opts);
  } catch (error) {
    if (error instanceof Error && CONNECTION_FAILURE.test(error.message)) throw new QueueUnavailableError();
    throw error;
  }
}

/**
 * A BullMQ queue's name *is* its Redis key prefix (`bull:<name>:…`), so on the one
 * Redis this portfolio shares it is the only thing that separates two products'
 * workers. Both abetagent and abetflow registered `"runs"`, and the result is still
 * stored in db 0 as of 2026-10-05: one `bull:runs` keyspace holding 20 jobs from both
 * products under a single id counter, six of them abetflow's `run-execution` payloads
 * failed by abetagent's own code (`prisma.run.findUnique()` on `where: { id:
 * undefined }` — abetflow's schema has no `model Run`, this one's has,
 * schema.prisma:140). Neither runner could tell the other's payload from its own
 * except by crashing on a field it never receives, and from outside that crash looks
 * like a flaky worker rather than a stolen job.
 *
 * Named once and used by both the Queue and the Worker so the two cannot drift: a
 * Worker on a name the Queue never enqueues to drains nothing and says so quietly.
 * `shared/check-queues.sh` gates uniqueness portfolio-wide plus Queue/Worker
 * agreement in each direction. The `queues` key stays `runs`, so `/api/health` and
 * the console's queue-depth panel are unaffected — they read the key, not the name.
 *
 * A hyphen separates, not a colon: bullmq 5.81.5 throws
 * `Queue name cannot contain :` (`queue-base.js:35`) the moment a name holds one, so
 * the `abetagent:runs` form is not a style choice but an unloadable module. Found by
 * constructing this app's own Queue against a scratch Redis db, not by reading the
 * docs — the guard was green on the colon name, which is why it now asserts
 * constructibility too.
 */
export const RUNS_QUEUE = "abetagent-runs";

/**
 * Billing mail — the trial nudges and the cancellation pair — gets its own name
 * for the reason above: a queue name is the Redis keyspace, so sharing
 * `abetagent-runs` would let the run worker take a `{ workspaceId, offsetDays }`
 * payload and call `runAgentRun(undefined)`. It is also a different shape of
 * work: one email per job, and it may sit in Redis for a week before anything
 * runs it. `runBillingJob` dispatches on the job name, so the keyspace holds
 * every mail kind and the worker that drains it is named once.
 */
export const BILLING_QUEUE = "abetagent-billing";

/**
 * Built on first touch, not at import, because `new Queue()` is not inert. Handed a
 * lazy-connect client it opens that connection on the next tick and writes
 * `bull:<name>:meta` before anything calls `add()` — measured on a scratch db against
 * this module's own twin in abetflow (same bullmq 5.81.5): a script that only
 * constructed a queue was still alive 30s later with the client at `status=connecting`
 * and one key in the db it pointed at, and importing the module at all meant writing
 * to Redis, which in dev defaults to db 0. So no offline test of the queue name could
 * be written, and `tsx --test` never exited. See §8.26.7 and §8.27.
 *
 * The name stays as the first argument of the Queue construction, which is where
 * `shared/check-queues.sh` reads it: memoising does not move the asserted fact.
 */
const built: { runs?: Queue; billing?: Queue } = {};

/** Every Worker this process started, so shutdownWorkers() can actually close them. */
const workers: Worker[] = [];

/**
 * Retention applied to every job this queue creates, as `defaultJobOptions` on the
 * construction (not in `enqueue`) so the paths that add directly are bounded too. Port
 * of the leadgenius convention (#61, §8.33) to this app — #64.
 *
 * `removeOnComplete: true`: this app's `GET /api/health` reads
 * `getJobCounts("waiting", "active", "failed")` and never `completed` (read from
 * `src/app/api/health/route.ts`), so a retained completed job is a Redis key with no
 * reader — the durable record of a run is SQLite, not the queue.
 * `removeOnFail: 100`: a failed job's hash is the only place its payload and stack
 * survive, so failures are kept, bounded to survive a storm without growing forever;
 * it makes the `failed` number "recent failures" rather than cumulative.
 *
 * It is a default: bullmq merges `{ ...defaultJobOptions, ...opts }` per add, so any
 * add naming its own retention still wins.
 */
import { JOB_RETENTION } from "./queue-retention";

export const queues = {
  get runs(): Queue {
    return (built.runs ??= new Queue(RUNS_QUEUE, { connection, defaultJobOptions: JOB_RETENTION }));
  },
  get billing(): Queue {
    return (built.billing ??= new Queue(BILLING_QUEUE, { connection, defaultJobOptions: JOB_RETENTION }));
  },
};

export async function startWorkers() {
  const { runAgentRun } = await import("./runner");
  const { runBillingJob } = await import("./billing-jobs");

  const worker = new Worker(RUNS_QUEUE, async (job: Job) => {
    const { runId } = job.data as { runId: string };
    await runAgentRun(runId);
  }, { connection, concurrency: 5 });

  // Concurrency 1: a billing mail is one message to one owner, and the mail
  // transport is the slow part. Nothing about correctness changes with more, so
  // keep it low.
  const billingWorker = new Worker(BILLING_QUEUE, async (job: Job) => {
    await runBillingJob(job as Job<TrialNudgeData | CancellationData>);
  }, { connection, concurrency: 1 });

  workers.push(worker, billingWorker);
  console.log("AbetAgent workers started");
}

/**
 * Ceiling on how long shutdown waits for in-flight Redis setup to land before tearing
 * the queue down anyway. Two seconds because the only case that waits that long is a
 * Redis that answers nothing, and that one is already measured clean.
 */
const SHUTDOWN_SETTLE_MS = 2_000;

/**
 * Graceful shutdown: settle, then Workers, then Queues, then the shared client.
 *
 * Why the settle comes first, in the order the failures were actually measured.
 *
 * (1) Closing the client while a queue's connect is still in flight is an exit. bullmq
 *     attaches `initializing.catch(err => this.emit('error', err))` to that connect
 *     (`redis-connection.js:87`), and the only suppression for the rejection lives
 *     inside `close()`'s `if (!this.extraOptions.shared)` branch
 *     (`redis-connection.js:429`) — never taken here, because this app hands bullmq a
 *     *shared* client on purpose. So the `error` lands on an EventEmitter with no
 *     listener, which Node treats as a crash:
 *
 *       Error: Connection is closed.
 *         at StandaloneConnector.js:46
 *       Emitted 'error' event on RedisConnection instance at:
 *         at bullmq/dist/cjs/classes/redis-connection.js:87:45
 *
 *     Measured rc=1 for a queue touched and closed in the same tick, rc=0 for the same
 *     script after letting the connection reach ready.
 * (2) A Worker is not ready when the client is. Its own setup issues commands after the
 *     shared connect lands, so waiting only on `connection` still died mid-drain —
 *     measured rc=1 with `Stream isn't writeable and enableOfflineQueue options is
 *     false` at `select` (`event_handler.js:41`), i.e. a Worker issuing SELECT on a
 *     client that had already been disconnected. Hence readiness is awaited on every
 *     started object, not on the client.
 * (3) `waitUntilReady()` must be caught as it is created. Abandoning one that never
 *     lands (the dead-Redis case) is itself an unhandled rejection — measured, and it
 *     exits 1 like the crash it was meant to prevent. The `.catch` below is what makes
 *     racing it safe.
 *
 * Workers are kept in `workers` precisely so they can be closed at all: the body this
 * replaces closed no Worker (`startWorkers()` kept them in a local, unreachable from
 * here) and ended in `connection.quit()`, which on a client that never connected throws
 * `Stream isn't writeable and enableOfflineQueue options is false`.
 *
 * `disconnect()` rather than `quit()`: quit() sends QUIT and waits for the reply, which
 * is the part that throws on a client that never connected — `Stream isn't writeable
 * and enableOfflineQueue options is false`, because the app sets `enableOfflineQueue:
 * false` deliberately so a down Redis fails fast instead of buffering. disconnect()
 * closes what exists and is a no-op otherwise.
 *
 * Idempotent — `built` and `workers` are emptied as they close, so a second call has
 * nothing left to close and cannot double-disconnect.
 */
export async function shutdownWorkers() {
  const closingWorkers = workers.splice(0);
  const closingQueues = Object.values(built);
  for (const key of Object.keys(built)) delete (built as Record<string, Queue>)[key];

  await Promise.race([
    Promise.all([...closingQueues, ...closingWorkers].map((item) => item.waitUntilReady().catch(() => undefined))),
    new Promise((resolve) => setTimeout(resolve, SHUTDOWN_SETTLE_MS)),
  ]);

  await Promise.all(closingWorkers.map((worker) => worker.close()));
  await Promise.all(closingQueues.map((queue) => queue.close()));
  connection.disconnect();
}
