#!/usr/bin/env node
// Generate a fully synthetic, controlled disabled-skill benchmark corpus.
//
// 100 skills in 20 clusters of 5. Each cluster is one domain; the 5 skills in
// a cluster are sibling capabilities and therefore each other's confounders.
//
// Three cluster tiers — three description regimes, three discrimination goals:
//
//  - DISTINCT (7 clusters): each description names its own capability
//    precisely and in isolation. Metadata alone routes it. -> baseline; every
//    method should pass.
//  - CONFUSABLE (6 clusters): each description states its primary capability
//    but ALSO name-drops two sibling capabilities as "related". The signal is
//    present but muddied. -> separates naive lexical/embedding matching from
//    careful reasoning over metadata.
//  - NEAR-DUPLICATE (7 clusters): the 5 sibling descriptions are identical —
//    they name only the domain, never the capability. The distinguishing
//    capability exists ONLY in the SKILL.md body. -> separates metadata-only
//    routing from body-reading routing.
//
// Emits queries.json: benchmark queries phrased around the capability (never
// copying the skill id), 8 per tier.
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "synthetic-skills");
const QUERIES_OUT = join(__dirname, "queries.json");

// tier: "distinct" | "confusable" | "near-duplicate"
const CLUSTERS = [
  {
    id: "postgres", tier: "confusable", domain: "PostgreSQL",
    skills: [
      { cap: "replication", capPhrase: "streaming replication between a primary and standby",
        body: "Configure `wal_level=replica`, create a physical replication slot, run `pg_basebackup` to seed the standby, and set `primary_conninfo` so the standby streams WAL from the primary. Verify with `pg_stat_replication`.",
        query: "Set up a hot standby that continuously streams write-ahead log changes from my primary database so I have a read replica that stays in sync." },
      { cap: "backup", capPhrase: "logical backup and point-in-time restore",
        body: "Take consistent logical dumps with `pg_dump`/`pg_dumpall`, schedule base backups, archive WAL segments, and perform point-in-time recovery by setting `recovery_target_time`.",
        query: "I need a scheduled dump of my database plus the ability to restore it to an exact timestamp after a bad deploy." },
      { cap: "indexing", capPhrase: "index design and query plan optimization",
        body: "Analyze slow queries with `EXPLAIN ANALYZE`, choose between B-tree, GIN, BRIN and partial indexes, and rewrite predicates so the planner uses them. Drop redundant indexes.",
        query: "My queries are doing sequential scans — help me pick the right index types and rewrite the queries so the planner uses them." },
      { cap: "partitioning", capPhrase: "declarative table partitioning",
        body: "Convert a large table to declarative range/list partitioning, create partitions per period, attach/detach partitions, and route inserts. Manage partition pruning.",
        query: "My events table is 800M rows — split it by month so old data can be dropped cheaply and the planner prunes scans." },
      { cap: "vacuum", capPhrase: "autovacuum and bloat control",
        body: "Diagnose table/index bloat, tune `autovacuum_vacuum_scale_factor` and cost limits, run `VACUUM FULL`/`pg_repack`, and stop transaction-ID wraparound.",
        query: "Dead tuples are piling up and disk usage keeps growing — tune the background cleanup so bloat stops accumulating." },
    ],
  },
  {
    id: "kafka", tier: "confusable", domain: "Apache Kafka",
    skills: [
      { cap: "topic-config", capPhrase: "topic creation and retention configuration",
        body: "Create topics with the right partition count and replication factor, set `retention.ms`, `cleanup.policy`, and `min.insync.replicas` per topic.",
        query: "Create a new event stream with enough partitions for throughput and a 7-day retention window." },
      { cap: "consumer-lag", capPhrase: "consumer group lag diagnosis",
        body: "Inspect group offsets with `kafka-consumer-groups`, compute lag per partition, find stuck members, and rebalance or reset offsets.",
        query: "My downstream service is falling behind the stream — figure out which partitions are backed up and why the workers can't keep up." },
      { cap: "schema-registry", capPhrase: "schema registry and Avro compatibility",
        body: "Register Avro/Protobuf schemas, set compatibility mode (BACKWARD/FORWARD/FULL), and evolve schemas without breaking existing consumers.",
        query: "I'm changing a message field — make sure old consumers don't break when the new message format ships." },
      { cap: "mirrormaker", capPhrase: "cross-cluster replication with MirrorMaker",
        body: "Configure MirrorMaker 2 connectors to replicate topics and consumer offsets between a source and a target cluster across regions.",
        query: "Copy all topics from our US cluster to a new EU cluster, including consumer offsets, so we can fail over regions." },
      { cap: "acl", capPhrase: "authorization ACLs and client quotas",
        body: "Define ACLs granting produce/consume on resources to principals, enforce per-client quotas, and audit access with the authorizer.",
        query: "Lock down who can publish to the payments stream and cap how much bandwidth any single client can use." },
    ],
  },
  {
    id: "k8s", tier: "confusable", domain: "Kubernetes",
    skills: [
      { cap: "rollout", capPhrase: "Deployment rollout and rollback",
        body: "Manage Deployment rollouts: set rolling-update surge/unavailable, watch rollout status, pause/resume, and roll back to a previous ReplicaSet revision.",
        query: "Ship a new version of my service gradually and give me a one-command way to revert if error rates climb." },
      { cap: "ingress", capPhrase: "Ingress routing and TLS",
        body: "Define Ingress resources with host/path rules, attach TLS secrets, configure the ingress controller annotations for rewrites and timeouts.",
        query: "Expose two services under one hostname on different paths and terminate HTTPS with my certificate." },
      { cap: "autoscaling", capPhrase: "horizontal pod autoscaling",
        body: "Configure a HorizontalPodAutoscaler on CPU/memory or custom metrics, set min/max replicas, tune stabilization windows and scaling policies.",
        query: "Make my web pods automatically grow and shrink with traffic between 3 and 30 replicas based on CPU." },
      { cap: "rbac", capPhrase: "role-based access control",
        body: "Create Roles/ClusterRoles and bindings, scope ServiceAccount permissions to namespaces, and follow least-privilege for CI principals.",
        query: "Give the CI service account permission to deploy only in the staging namespace and nothing else." },
      { cap: "netpolicy", capPhrase: "network policy isolation",
        body: "Write NetworkPolicy resources to default-deny traffic and explicitly allow pod-to-pod ingress/egress by label selector and port.",
        query: "Stop every pod from talking to the database except the three services that actually need it." },
    ],
  },
  {
    id: "redis", tier: "confusable", domain: "Redis",
    skills: [
      { cap: "caching", capPhrase: "cache-aside patterns and TTLs",
        body: "Implement cache-aside read-through, choose TTLs, prevent stampedes with locks/jitter, and pick eviction-friendly key shapes.",
        query: "Put a read cache in front of my slow API with sensible expiry and protection against everything expiring at once." },
      { cap: "pubsub", capPhrase: "pub/sub and stream messaging",
        body: "Use PUBLISH/SUBSCRIBE and Redis Streams with consumer groups, acknowledgements, and pending-entry recovery for at-least-once delivery.",
        query: "I want lightweight fan-out messaging where workers consume events with acknowledgement and can recover ones they missed." },
      { cap: "persistence", capPhrase: "RDB and AOF persistence",
        body: "Choose between RDB snapshots and AOF, tune `appendfsync`, configure save points, and plan restart/restore durability.",
        query: "Make sure Redis can survive a crash without losing the last few seconds of writes — configure its on-disk durability." },
      { cap: "cluster", capPhrase: "cluster sharding and resharding",
        body: "Set up Redis Cluster hash slots, add/remove nodes, reshard slots online, and handle MOVED/ASK redirections in clients.",
        query: "My dataset no longer fits on one node — spread the keyspace across six nodes and let me add more later without downtime." },
      { cap: "eviction", capPhrase: "memory limits and eviction policy tuning",
        body: "Set `maxmemory`, choose an eviction policy (allkeys-lru, volatile-ttl, …), and analyze key memory with `MEMORY USAGE` and `--bigkeys`.",
        query: "Redis keeps hitting the memory ceiling — cap its memory and make it drop the least useful keys instead of erroring." },
    ],
  },
  {
    id: "nginx", tier: "confusable", domain: "NGINX",
    skills: [
      { cap: "proxy", capPhrase: "reverse proxy configuration",
        body: "Configure `proxy_pass`, forward headers, buffering, and timeouts so NGINX fronts an upstream application server.",
        query: "Put NGINX in front of my Node app so external traffic hits NGINX and gets forwarded to the app on localhost." },
      { cap: "loadbalancing", capPhrase: "upstream load balancing",
        body: "Define an `upstream` block across several backends, pick a balancing method (round-robin, least_conn, ip_hash), and set health checks.",
        query: "Spread incoming requests across my four backend servers and stop sending traffic to one if it goes unhealthy." },
      { cap: "tls", capPhrase: "TLS termination and HTTPS",
        body: "Configure `ssl_certificate`, modern ciphers/protocols, HSTS, OCSP stapling, and an HTTP→HTTPS redirect.",
        query: "Serve my site over HTTPS with a strong modern cipher suite and force every plain HTTP visitor to the secure URL." },
      { cap: "ratelimit", capPhrase: "request rate limiting",
        body: "Use `limit_req_zone`/`limit_req` and `limit_conn` to throttle abusive clients, set burst and nodelay, return 429s.",
        query: "Some clients are hammering my login endpoint — throttle requests per IP and reject the ones over the limit." },
      { cap: "caching", capPhrase: "proxy response caching",
        body: "Configure `proxy_cache_path` and cache keys, set cacheable status codes and TTLs, and add cache purge/bypass rules.",
        query: "Cache responses from my slow upstream inside NGINX so repeat requests are served without hitting the backend." },
    ],
  },
  {
    id: "terraform", tier: "confusable", domain: "Terraform",
    skills: [
      { cap: "state", capPhrase: "remote state and locking",
        body: "Configure a remote backend (S3 + DynamoDB lock), migrate local state, and handle state locking and `terraform state` surgery.",
        query: "Move my infrastructure state off my laptop into shared remote storage so teammates don't clobber each other's applies." },
      { cap: "modules", capPhrase: "reusable module authoring",
        body: "Factor resources into a versioned module with input variables, outputs, and sane defaults; publish and pin module versions.",
        query: "Turn this repeated block of resources into a parameterized, versioned building block I can reuse across projects." },
      { cap: "providers", capPhrase: "provider and multi-region configuration",
        body: "Configure provider blocks, aliases for multiple regions/accounts, version constraints, and pass aliased providers to modules.",
        query: "I need to manage resources in three AWS regions from one config — set up the provider aliases." },
      { cap: "drift", capPhrase: "drift detection and reconciliation",
        body: "Detect out-of-band changes with `terraform plan -refresh-only`, reconcile drift, and decide between import and re-apply.",
        query: "Someone changed infrastructure by hand in the console — find what no longer matches my config and reconcile it." },
      { cap: "import", capPhrase: "importing existing resources",
        body: "Bring pre-existing un-managed resources under management with `import` blocks / `terraform import`, then generate matching config.",
        query: "We have production resources created manually years ago — bring them under management without recreating them." },
    ],
  },
  {
    id: "elasticsearch", tier: "near-duplicate", domain: "Elasticsearch",
    skills: [
      { cap: "mappings", capPhrase: "index mappings and field types",
        body: "Design explicit mappings, pick field types (keyword vs text), configure multi-fields, and avoid mapping explosions.",
        query: "My documents are being indexed with the wrong field types — define an explicit schema so dates and keywords behave." },
      { cap: "querydsl", capPhrase: "Query DSL and relevance tuning",
        body: "Compose bool/must/should queries, tune relevance with boosting and function_score, and debug scoring with `explain`.",
        query: "Search results are ranked badly — help me write the query so the most relevant documents come first." },
      { cap: "ilm", capPhrase: "index lifecycle management",
        body: "Configure ILM policies with hot/warm/cold/delete phases, rollover on size/age, and attach policies to index templates.",
        query: "Automatically roll over my logging indices and delete anything older than 30 days without manual cleanup." },
      { cap: "snapshots", capPhrase: "snapshot and restore",
        body: "Register a snapshot repository, schedule snapshots with SLM, and restore selected indices after data loss.",
        query: "Set up scheduled backups of my cluster to object storage and let me restore one index if it gets corrupted." },
      { cap: "reindex", capPhrase: "reindexing and zero-downtime migration",
        body: "Use the reindex API with aliases to migrate data to a new mapping, throttle reindex, and cut over with zero downtime.",
        query: "I changed the index schema — move all existing data to the new index and switch traffic over without downtime." },
    ],
  },
  {
    id: "airflow", tier: "near-duplicate", domain: "Apache Airflow",
    skills: [
      { cap: "dag-authoring", capPhrase: "DAG and task authoring",
        body: "Write DAGs with the TaskFlow API, declare dependencies, set retries and SLAs, and parameterize with params.",
        query: "Turn this multi-step nightly job into a proper pipeline with task dependencies, retries, and alerting on failure." },
      { cap: "scheduling", capPhrase: "schedule intervals and catchup",
        body: "Configure schedule intervals/cron, `start_date`, timezone handling, and the `catchup` flag for historical runs.",
        query: "My pipeline should run every weekday at 2am in my timezone and not try to back-fill months of missed runs." },
      { cap: "xcom", capPhrase: "passing data between tasks with XCom",
        body: "Push/pull values via XCom, use custom XCom backends for large payloads, and avoid passing big data through the metadata DB.",
        query: "One task computes an ID that the next task needs — wire the value through without writing it to a file." },
      { cap: "sensors", capPhrase: "sensors and external triggers",
        body: "Use sensors (file/S3/external-task) in reschedule mode, set timeouts/pokes, and trigger DAGs from external events.",
        query: "My pipeline should wait until an upstream file lands in storage before it starts processing." },
      { cap: "backfill", capPhrase: "backfilling and reprocessing history",
        body: "Run targeted backfills for a date range, clear and re-run failed task instances, and reprocess after a logic fix.",
        query: "I fixed a bug in a transform — re-run the pipeline for all of last quarter's dates only." },
    ],
  },
  {
    id: "spark", tier: "near-duplicate", domain: "Apache Spark",
    skills: [
      { cap: "dataframe", capPhrase: "DataFrame transformations",
        body: "Build DataFrame pipelines with select/withColumn/groupBy, use built-in functions over UDFs, and chain transformations lazily.",
        query: "Help me express this row-by-row aggregation as a clean column-oriented transformation pipeline." },
      { cap: "skew", capPhrase: "data skew and partition tuning",
        body: "Diagnose skewed partitions from the UI, repartition/salt hot keys, and tune `spark.sql.shuffle.partitions`.",
        query: "One task in my job runs 20x longer than the rest — figure out why the data is lopsided and even it out." },
      { cap: "broadcast-join", capPhrase: "broadcast joins",
        body: "Force/prevent broadcast joins with hints, set the broadcast threshold, and avoid shuffles when one side is small.",
        query: "I'm joining a huge table with a tiny lookup table — make the small one ship to every node so there's no shuffle." },
      { cap: "checkpointing", capPhrase: "checkpointing and lineage truncation",
        body: "Use `checkpoint()` to truncate long lineage in iterative jobs, configure the checkpoint dir, and balance cost vs recompute.",
        query: "My iterative algorithm gets slower each round because the computation history keeps growing — cut the lineage." },
      { cap: "memory-tuning", capPhrase: "executor memory tuning",
        body: "Tune executor/driver memory, `memoryOverhead`, cores per executor, and fix OOM/spill from the metrics.",
        query: "Executors keep dying with out-of-memory errors — size the memory and cores so the job stops crashing." },
    ],
  },
  {
    id: "prometheus", tier: "near-duplicate", domain: "Prometheus",
    skills: [
      { cap: "scrape-config", capPhrase: "scrape and service-discovery configuration",
        body: "Write `scrape_configs`, use service discovery, relabel targets, and set scrape intervals/timeouts.",
        query: "Get Prometheus to automatically find and pull metrics from all my pods as they come and go." },
      { cap: "recording-rules", capPhrase: "recording rules for precomputed series",
        body: "Define recording rules to precompute expensive expressions on a schedule and speed up dashboards.",
        query: "My dashboard query is too slow because it aggregates millions of series — precompute it on a timer." },
      { cap: "alerting", capPhrase: "alerting rules and Alertmanager routing",
        body: "Write alerting rules with `for` durations, severity labels, and route/group/silence them in Alertmanager.",
        query: "Page me when error rate stays high for five minutes, and route warnings to Slack instead of PagerDuty." },
      { cap: "federation", capPhrase: "federation across Prometheus servers",
        body: "Configure `/federate` so a global Prometheus aggregates selected series from regional Prometheis.",
        query: "I have one Prometheus per region — roll selected metrics up into a single global view." },
      { cap: "exporters", capPhrase: "writing a custom metrics exporter",
        body: "Build a custom exporter exposing `/metrics` with correct types (counter/gauge/histogram) and labels.",
        query: "My in-house service has no metrics — instrument it so Prometheus can scrape counters and histograms from it." },
    ],
  },
  {
    id: "rabbitmq", tier: "near-duplicate", domain: "RabbitMQ",
    skills: [
      { cap: "exchanges", capPhrase: "exchange and routing topology",
        body: "Choose direct/topic/fanout/headers exchanges, design routing keys and bindings for the messaging topology.",
        query: "Design the routing so order events fan out to three services but only one of them gets the refund events." },
      { cap: "dead-letter", capPhrase: "dead-letter queues and retries",
        body: "Configure dead-letter exchanges, TTL-based retry queues, and a parking-lot queue for poison messages.",
        query: "When a message fails processing repeatedly, stop it from looping forever and move it somewhere for inspection." },
      { cap: "quorum-queues", capPhrase: "quorum queues and durability",
        body: "Use quorum queues for replicated durability, set replication factor, and understand the trade-offs vs classic queues.",
        query: "I can't afford to lose messages if a broker node dies — make the queue replicated across nodes." },
      { cap: "shovel", capPhrase: "shovel and federation between brokers",
        body: "Set up the shovel/federation plugins to move messages between brokers or data centers reliably.",
        query: "Continuously move messages from our on-prem broker to the one in the cloud without writing a custom bridge." },
      { cap: "prefetch", capPhrase: "consumer prefetch and fair dispatch",
        body: "Tune the `prefetch_count`/QoS so fast consumers aren't starved and slow ones don't hoard unacked messages.",
        query: "One worker grabs a huge batch of messages and sits on them while others idle — make dispatch fair." },
    ],
  },
  {
    id: "graphql", tier: "near-duplicate", domain: "GraphQL",
    skills: [
      { cap: "schema-design", capPhrase: "schema and type design",
        body: "Design the SDL schema: types, interfaces, unions, nullability, pagination connections, and naming conventions.",
        query: "Help me model my domain as a GraphQL type system with proper pagination and nullability." },
      { cap: "resolvers", capPhrase: "resolver implementation",
        body: "Implement resolver functions, thread context, handle arguments, and structure resolver maps per type.",
        query: "Wire up the functions that actually fetch the data for each field in my schema." },
      { cap: "dataloader", capPhrase: "the N+1 problem and batching",
        body: "Introduce DataLoader to batch and cache per-request field fetches and eliminate N+1 database round-trips.",
        query: "Loading a list with nested fields fires hundreds of duplicate database queries — batch them per request." },
      { cap: "subscriptions", capPhrase: "real-time subscriptions",
        body: "Implement subscriptions over WebSockets with a pub/sub backend so clients receive live updates.",
        query: "Push live updates to clients when data changes instead of making them poll." },
      { cap: "federation", capPhrase: "federated schema composition",
        body: "Split the graph into subgraphs with federation directives and compose them into one supergraph via a gateway.",
        query: "Three teams each own part of the graph — let them ship separate services that compose into one API." },
    ],
  },
  {
    id: "mysql", tier: "near-duplicate", domain: "MySQL",
    skills: [
      { cap: "replication", capPhrase: "primary-replica binlog replication",
        body: "Configure binary logging and GTIDs, provision a replica with a consistent snapshot, set up the replication channel, and monitor `SHOW REPLICA STATUS` for lag.",
        query: "Stand up a read replica that follows my main MySQL server's binary log so reporting queries can hit the copy." },
      { cap: "backup", capPhrase: "logical and physical backups",
        body: "Take logical dumps with `mysqldump`/`mysqlpump`, physical backups with Percona XtraBackup, and restore to a point in time using binlogs.",
        query: "I want nightly backups of my MySQL database plus a way to roll back to a specific moment before a bad migration." },
      { cap: "indexing", capPhrase: "index and query optimization",
        body: "Read `EXPLAIN` output, add composite/covering indexes, fix non-sargable predicates, and remove unused indexes.",
        query: "Some MySQL queries are slow and scanning whole tables — design the indexes and rewrite them to be fast." },
      { cap: "partitioning", capPhrase: "table partitioning",
        body: "Apply RANGE/HASH/LIST partitioning to large tables, manage partitions over time, and rely on partition pruning.",
        query: "My MySQL orders table is enormous — partition it by year so old partitions can be dropped quickly." },
      { cap: "tuning", capPhrase: "InnoDB buffer pool and server tuning",
        body: "Size `innodb_buffer_pool_size`, tune `innodb_log_file_size` and flushing, and adjust connection/thread settings from metrics.",
        query: "My MySQL server is thrashing under load — tune the InnoDB memory and flushing settings so it stops hitting disk so hard." },
    ],
  },
  {
    id: "csv", tier: "distinct", domain: "CSV data",
    skills: [
      { cap: "clean", capPhrase: "cleaning messy columns",
        body: "Trim whitespace, fix encodings, normalize null tokens, coerce types, and standardize headers in a CSV.",
        query: "This CSV has inconsistent capitalization, stray spaces, and mixed null markers — clean the columns up." },
      { cap: "merge", capPhrase: "joining and merging CSV files",
        body: "Join multiple CSVs on a key column, handle inner/outer joins, and reconcile mismatched schemas.",
        query: "Merge these three CSV exports into one table joined on the customer id column." },
      { cap: "dedupe", capPhrase: "deduplicating rows",
        body: "Detect exact and fuzzy duplicate rows, choose which copy to keep, and report what was removed.",
        query: "My CSV has the same record entered several times — find and remove the duplicate rows." },
      { cap: "pivot", capPhrase: "pivoting and aggregating",
        body: "Reshape long CSV data into a pivot table with grouped aggregations (sum/count/avg).",
        query: "Turn this long transaction CSV into a pivot of totals by month and region." },
      { cap: "validate", capPhrase: "schema validation",
        body: "Validate a CSV against a schema: required columns, types, ranges, and enum values; report violations.",
        query: "Check this CSV against my expected column types and ranges and tell me every row that breaks the rules." },
    ],
  },
  {
    id: "image", tier: "distinct", domain: "image files",
    skills: [
      { cap: "resize", capPhrase: "resizing and rescaling images",
        body: "Resize images to target dimensions, preserve aspect ratio, and generate responsive size variants.",
        query: "Resize this batch of photos to 800px wide while keeping their proportions." },
      { cap: "convert", capPhrase: "converting image formats",
        body: "Convert between PNG/JPEG/WebP/AVIF, manage quality, and strip or preserve metadata.",
        query: "Convert all these PNGs to WebP to save bandwidth." },
      { cap: "watermark", capPhrase: "applying watermarks",
        body: "Overlay a text or logo watermark with configurable opacity, position, and scaling.",
        query: "Stamp my logo in the bottom-right corner of every product image." },
      { cap: "crop", capPhrase: "cropping and aspect-ratio framing",
        body: "Crop images to a region or aspect ratio, with smart/centered cropping options.",
        query: "Crop these portraits to a square 1:1 frame centered on the subject." },
      { cap: "compress", capPhrase: "compressing and optimizing file size",
        body: "Reduce image file size with lossy/lossless optimization while keeping acceptable visual quality.",
        query: "These images are huge — shrink their file size as much as possible without obvious quality loss." },
    ],
  },
  {
    id: "video", tier: "distinct", domain: "video files",
    skills: [
      { cap: "trim", capPhrase: "trimming and cutting clips",
        body: "Cut a video to a start/end range, split into segments, and join clips without re-encoding when possible.",
        query: "Cut the first 30 seconds and the last minute off this recording." },
      { cap: "transcode", capPhrase: "transcoding codecs and resolutions",
        body: "Transcode between codecs/containers, change resolution and bitrate, and target device-friendly profiles.",
        query: "Re-encode this 4K video to 1080p H.264 so it plays everywhere." },
      { cap: "subtitle", capPhrase: "adding subtitles and captions",
        body: "Burn in or soft-mux subtitle tracks, sync timing, and convert between SRT/VTT.",
        query: "Add this SRT subtitle file to my video as a selectable caption track." },
      { cap: "thumbnail", capPhrase: "extracting thumbnails and frames",
        body: "Grab a frame at a timestamp, generate a contact sheet, and pick representative thumbnails.",
        query: "Pull a poster image from the 10-second mark of this video." },
      { cap: "concat", capPhrase: "concatenating multiple videos",
        body: "Concatenate several clips into one file, handling mismatched codecs and resolutions.",
        query: "Stitch these five clips together into a single continuous video." },
    ],
  },
  {
    id: "audio", tier: "distinct", domain: "audio files",
    skills: [
      { cap: "normalize", capPhrase: "loudness normalization",
        body: "Normalize loudness to a target LUFS, apply limiting, and even out volume across tracks.",
        query: "These recordings have wildly different volumes — normalize them all to a consistent loudness." },
      { cap: "denoise", capPhrase: "noise reduction",
        body: "Remove background hiss/hum with noise profiles and spectral denoising.",
        query: "There's a constant air-conditioner hum in this recording — clean it out." },
      { cap: "split", capPhrase: "splitting audio on silence",
        body: "Detect silence and split a long recording into separate tracks at the gaps.",
        query: "Split this hour-long recording into separate files wherever there's a long pause." },
      { cap: "convert", capPhrase: "converting audio formats",
        body: "Convert between WAV/MP3/FLAC/AAC, set bitrate/sample rate, and manage tags.",
        query: "Convert these WAV files to MP3 at 192kbps." },
      { cap: "fade", capPhrase: "applying fades and trimming silence",
        body: "Add fade-in/out, trim leading/trailing silence, and apply crossfades between clips.",
        query: "Add a smooth fade-in and fade-out to this track and trim the dead air at the start." },
    ],
  },
  {
    id: "markdown", tier: "distinct", domain: "Markdown documents",
    skills: [
      { cap: "toc", capPhrase: "generating a table of contents",
        body: "Scan headings and insert/update a linked table of contents in a Markdown file.",
        query: "Add an auto-generated table of contents to the top of this long README." },
      { cap: "lint", capPhrase: "linting and style fixing",
        body: "Lint Markdown for style issues (heading levels, list markers, line length) and auto-fix them.",
        query: "Clean up the inconsistent heading levels and list bullets in these docs." },
      { cap: "convert", capPhrase: "converting to HTML or PDF",
        body: "Render Markdown to styled HTML or PDF with a template and syntax highlighting.",
        query: "Turn this Markdown spec into a nicely styled PDF." },
      { cap: "frontmatter", capPhrase: "editing YAML frontmatter",
        body: "Read, validate, and bulk-edit YAML frontmatter fields across many Markdown files.",
        query: "Add a `lastUpdated` field to the frontmatter of every doc in this folder." },
      { cap: "diagram", capPhrase: "embedding Mermaid diagrams",
        body: "Author and embed Mermaid diagram code blocks and verify they render.",
        query: "Add a flowchart to this doc using a Mermaid code block." },
    ],
  },
  {
    id: "json", tier: "distinct", domain: "JSON data",
    skills: [
      { cap: "query", capPhrase: "querying and extracting with JSONPath",
        body: "Extract values from JSON with JSONPath/jq-style expressions and filters.",
        query: "Pull every email address out of this big nested JSON document." },
      { cap: "validate", capPhrase: "JSON Schema validation",
        body: "Validate JSON documents against a JSON Schema and report each violation.",
        query: "Check this config file against my JSON Schema and list what's invalid." },
      { cap: "transform", capPhrase: "reshaping and transforming structure",
        body: "Restructure JSON: rename keys, flatten/nest, and map between two shapes.",
        query: "Reshape this API response into the flat structure my database expects." },
      { cap: "diff", capPhrase: "diffing two JSON documents",
        body: "Compute a structural diff between two JSON documents and present added/removed/changed paths.",
        query: "Show me exactly what changed between these two versions of the JSON config." },
      { cap: "schema-gen", capPhrase: "inferring a schema from samples",
        body: "Infer a JSON Schema from one or more example documents.",
        query: "Generate a JSON Schema from these three example payloads." },
    ],
  },
  {
    id: "regex", tier: "distinct", domain: "regular expressions",
    skills: [
      { cap: "extract", capPhrase: "extracting matches from text",
        body: "Write regexes to extract all matches/capture groups from text and return them structured.",
        query: "Pull every phone number out of this blob of text with a regular expression." },
      { cap: "replace", capPhrase: "search-and-replace with patterns",
        body: "Write find/replace regexes with backreferences for bulk text rewriting.",
        query: "Rewrite every date in this file from MM/DD/YYYY to YYYY-MM-DD with a pattern." },
      { cap: "validate", capPhrase: "validating string formats",
        body: "Write anchored regexes that validate whether a string matches a format (email, SKU, etc.).",
        query: "Give me a regex that checks whether a string is a valid internal order code." },
      { cap: "explain", capPhrase: "explaining and debugging a regex",
        body: "Break down an existing regex token by token and explain what it matches and why it fails.",
        query: "I have this cryptic regex that isn't matching what I expect — explain what it actually does." },
      { cap: "split", capPhrase: "splitting text on complex delimiters",
        body: "Split text on multi-character or pattern delimiters while handling quoting and edge cases.",
        query: "Split this log line into fields where the separator is one-or-more spaces or a pipe." },
    ],
  },
];

const DISTINCT_DESC = (domain, capPhrase) =>
  `Skill for ${capPhrase} in the context of ${domain}. Use when the user's task is specifically about ${capPhrase}.`;
const CONFUSABLE_DESC = (domain, capPhrase, sib1, sib2) =>
  `${domain} operations skill. Primary capability: ${capPhrase}. It sits among neighboring ${domain} areas — related skills cover ${sib1} and ${sib2} — so confirm the task is about ${capPhrase} specifically.`;
const NEARDUP_DESC = (domain) =>
  `Operate, configure, troubleshoot, and manage ${domain}. Use for ${domain} engineering tasks, day-to-day operations, and production support.`;

function descriptionFor(cluster, idx) {
  const s = cluster.skills[idx];
  if (cluster.tier === "distinct") return DISTINCT_DESC(cluster.domain, s.capPhrase);
  if (cluster.tier === "near-duplicate") return NEARDUP_DESC(cluster.domain);
  const sib1 = cluster.skills[(idx + 1) % cluster.skills.length].capPhrase;
  const sib2 = cluster.skills[(idx + 2) % cluster.skills.length].capPhrase;
  return CONFUSABLE_DESC(cluster.domain, s.capPhrase, sib1, sib2);
}

const main = async () => {
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const byTier = { distinct: [], confusable: [], "near-duplicate": [] };
  let skillCount = 0;

  for (const cluster of CLUSTERS) {
    for (let i = 0; i < cluster.skills.length; i++) {
      const s = cluster.skills[i];
      const id = `syn-${cluster.id}-${s.cap}`;
      const description = descriptionFor(cluster, i);
      const md = [
        "---",
        `name: ${id}`,
        `description: ${description}`,
        "---",
        "",
        `# ${cluster.domain}: ${s.capPhrase}`,
        "",
        "## When to use",
        "",
        `Use this skill for ${s.capPhrase} in ${cluster.domain}. This skill`,
        `specifically handles ${s.capPhrase} and nothing else in the`,
        `${cluster.domain} family.`,
        "",
        "## Procedure",
        "",
        s.body,
        "",
        "## Notes",
        "",
        `This is the ${cluster.domain} skill dedicated to ${s.capPhrase}.`,
        `Sibling skills cover other ${cluster.domain} capabilities; this one`,
        `is the right choice only when the task is about ${s.capPhrase}.`,
        "",
      ].join("\n");
      await mkdir(join(OUT_DIR, id), { recursive: true });
      await writeFile(join(OUT_DIR, id, "SKILL.md"), md);
      skillCount++;

      byTier[cluster.tier].push({
        id: `${cluster.id}-${s.cap}`,
        expected: `user:${id}`,
        cluster: cluster.id,
        confounders: cluster.skills.filter((x) => x.cap !== s.cap).map((x) => `user:syn-${cluster.id}-${x.cap}`),
        kind: cluster.tier,
        tier: cluster.tier,
        query: s.query,
      });
    }
  }

  // Spread-pick N queries from a tier across as many distinct clusters as possible.
  const pick = (arr, n) => {
    const out = [], seenCluster = new Set();
    for (const q of arr) { if (out.length >= n) break; if (!seenCluster.has(q.cluster)) { out.push(q); seenCluster.add(q.cluster); } }
    for (const q of arr) { if (out.length >= n) break; if (!out.includes(q)) out.push(q); }
    return out;
  };
  const selected = [
    ...pick(byTier.distinct, 8),
    ...pick(byTier.confusable, 8),
    ...pick(byTier["near-duplicate"], 8),
  ];

  await writeFile(QUERIES_OUT, JSON.stringify({ queries: selected }, null, 2) + "\n");
  const nClusters = (t) => CLUSTERS.filter((c) => c.tier === t).length;
  console.log(`generated ${skillCount} synthetic skills in ${OUT_DIR}`);
  console.log(`  distinct       clusters: ${nClusters("distinct")}  (metadata-distinguishable)`);
  console.log(`  confusable     clusters: ${nClusters("confusable")}  (metadata present but muddied)`);
  console.log(`  near-duplicate clusters: ${nClusters("near-duplicate")}  (metadata insufficient, body required)`);
  console.log(`wrote ${selected.length} queries to ${QUERIES_OUT}: ` +
    `${selected.filter((q) => q.tier === "distinct").length} distinct + ` +
    `${selected.filter((q) => q.tier === "confusable").length} confusable + ` +
    `${selected.filter((q) => q.tier === "near-duplicate").length} near-duplicate`);
};

main().catch((err) => { console.error(err); process.exit(1); });
