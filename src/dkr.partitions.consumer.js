const { Client } = require("pg");
const schema = require("./schema.partitions");

const clientId = process.env.HOSTNAME || "*";
const batchSerial = process.env.BATCH_SERIAL || 1;
const batchParallel = process.env.BATCH_PARALLEL || 10;

const boot = async () => {
  console.log("Connecting...");
  const client = new Client({ connectionString: process.env.PGSTRING });
  await client.connect();

  // Reset the schema
  try {
    await schema.create(client);
  } catch (err) {
    console.error(`Errors while upserting the schema: ${err.message}`);
  }

  // Results table
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS "fq"."results" (
      "client" VARCHAR(32),
      "offset" BIGINT,
      "topic" VARCHAR(50),
      "partition" VARCHAR(50),
      "payload" JSONB DEFAULT '{}',
      "created_at" TIMESTAMP DEFAULT NOW() NOT NULL,
      "processed_at" TIMESTAMP DEFAULT NOW() NOT NULL,
      PRIMARY KEY ("client", "offset")
      );
    `);
  } catch (err) {
    console.error("Error while creating the results table", err.message);
  }

  await schema.registerClient(client, clientId, true);
  // console.log(clientId, clientResult);

  let iterations = 0;
  let keepWorking = true;
  while (keepWorking) {
    // Get parallel messages
    const messages = [];
    for (let j = 0; j < batchParallel; j++) {
      messages.push(await schema.get(client, clientId));
    }

    // Committing the messages
    const results = await Promise.all(messages);
    for (const result of results) {
      if (result) {
        console.log(
          `[consumer][${clientId}][iteration:${iterations + 1}] ${
            result.partition
          }:${result.offset}`
        );
        await client.query(`
          INSERT INTO "fq"."results" VALUES (
            '${clientId}',
            ${result.offset},
            '${result.topic}',
            '${result.partition}',
            '${JSON.stringify(result.payload)}',
            '${result.createdAt.toISOString()}'
          )
        `);
        await result.commit();
        // await new Promise((r) => setTimeout(r, 1000));
      }
    }

    // console.log("===========================================");
    // console.log(results);
    // console.log("===========================================");

    // At least one non-null item to keep working
    keepWorking = results.find((item) => item !== null);
    iterations += 1;
  }

  // for (let i = 0; i < batchSerial; i++) {
  //   console.log(`Runing batch ${i + 1}/${batchSerial}...`);
  //   const promises = [];
  //   for (let j = 0; j < batchParallel; j++) {
  //     promises.push(schema.put(client, {}));
  //   }
  //   try {
  //     await Promise.all(promises);
  //   } catch (err) {
  //     console.error(`[batch ${i + 1}/${batchSerial}] error: ${err.message}`);
  //   }
  // }
};

boot()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("ERROR!");
    console.error(err.message);
    process.exit(-1);
  });