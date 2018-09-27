#!/usr/bin/env node

const {resolve} = require("path");
const fs = require("fs");

// parse cli arguments
const args = require("./parse-argv");

/*
* Run the program in async
* */
(async function run() {

    // get the full path to the migrations folder
    const pathToMigrations = resolve(process.cwd(), args.migrations || "postgres_migrations");

    // check if the migrations directory path is valid
    if(!fs.existsSync(pathToMigrations)) {
        console.error("Directory could not be found. Invalid path: %s", pathToMigrations)
        return process.exit(1);
    }

    switch(args.cmd) {
        case "create":
            await create(pathToMigrations);
            break;
        case "commit":
            await commitOrRollback({
                pathToMigrations,
                prompt: "Please select a migration point to commit up to:",
            });
            break;
        case "rollback":
            await commitOrRollback({
                pathToMigrations,
                prompt: "Please select a migration point to roll back past:",
            });
            break;
        // process-argv will throw before we get here so no need to throw again
        default: return;
    }
})();

/*
* Create a new migration
* */
async function create(pathToMigrations) {
    // prompt the user for a migration and timestamp it
    process.stdout.write("Enter migration name: ");
    let migrationName = (await promptUser()) || "new_migration";
    migrationName = JSON.parse(JSON.stringify(migrationName))
        .replace(/[\r\n]/g, "")
        .replace(/\s/g, "_");
    migrationName = migrationName || "new_migration";
    migrationName = `${Date.now()}_${migrationName}`;

    // check if the proposed new dir already exists
    const newDir = resolve(pathToMigrations, migrationName);
    if(fs.existsSync(newDir)) {
        console.error("Cannot create %s: already exists", newDir);
        process.exit(1);
    }

    try {
        // create the root migrations directory if it doesn't exist yet
        !fs.existsSync(pathToMigrations) && fs.mkdirSync(pathToMigrations);

        // make the directory and files
        fs.mkdirSync(newDir);
        fs.writeFileSync(resolve(newDir, `${migrationName}_commit.sql`), "");
        fs.writeFileSync(resolve(newDir, `${migrationName}_rollback.sql`), "");

        console.info("Successfully created migration: %s", migrationName);
    } catch (e) {
        console.error("Error when attempting to create migration files: %s", e.toString());
        process.exit(1);
    } finally {
        // pause stdin to cease execution
        process.stdin.pause();
    }
}

/*
* Commit or roll back all migrations up to a migration selected by the user
* */
async function commitOrRollback({ pathToMigrations, prompt }) {
    const {Pool} = require("pg");
    const pool = new Pool();

    // initialise the dotenv config if there is one
    const pathToEnv = resolve(process.cwd(), args.env || ".env");
    require("dotenv").config({ path: pathToEnv });

    // test the database connection
    try { await pool.query("SELECT 1") }
    catch (e) {
        const reasons = verifyEnv(pathToEnv).join("\n\t");
        console.error("\nCould not connect to database. %s\n\nPossible reasons:\n\t%s", e.toString(), reasons);
        process.exit(1);
    }

    // create the migrations table and a cursor if it doesn't exist
    await pool.query(
        "CREATE TABLE IF NOT EXISTS _migrations(cursor int, completed date DEFAULT now());" +
        "INSERT INTO _migrations(cursor) SELECT -1 WHERE NOT exists(SELECT 1 FROM _migrations)"
    );

    // get the migration directories
    let dirNames;
    try {
        dirNames = fs
            .readdirSync(pathToMigrations)
            .filter(subDir => !subDir.startsWith("."));
    } catch (e) {
        console.error("Reading migrations directory failed. %s", e.toString());
        process.exit(1);
    }

    // get the current migration cursor from the _migrations table
    const {rows} = await pool.query("SELECT cursor FROM _migrations");
    const cursor = rows && rows[0] ? rows[0].cursor : -1;

    console.info("\nCursor currently at: %s", dirNames[cursor] || "clean");

    // get the subset of applicable migrations for this database
    const subset = args.cmd === "commit"
        ? dirNames.slice(cursor + 1)
        : dirNames.slice(0).reverse().slice(dirNames.length - (cursor + 1));

    // return early if the database is already at the desired point
    if(subset < 1) {
        const reason = args.cmd === "commit"
            ? "the database is already fully migrated"
            : "the database is already clean";
        console.info("Cannot perform %s: %s", args.cmd, reason);
        return process.exit();
    }

    // if the user isn't just choosing to fast forward the migration
    // default the migration point to all migrations in the subset
    let migrateTo = subset.length - 1;
    if(!args.all) {
        try {
            // prompt the user to select a migration
            console.log(prompt);
            [{value: migrateTo}] = await spawnSelection(subset);
        } catch (e) {
            console.error("Nothing was selected: You must select a migration to go to", e.toString());
            process.exit(1);
        }
    }

    // get the new cursor which will be written to the database
    const newCursor = args.cmd === "commit"
        ? dirNames.findIndex(d => d === subset[migrateTo])
        : dirNames.findIndex(d => d === subset[migrateTo]) - 1;

    // select the migration sql files up to the specified point
    const migrationDirPaths = subset
        .slice(0, migrateTo + 1)
        .map(p => resolve(pathToMigrations, p));

    // attempt to read the sql files
    let sql;
    try {
        // create the migration file map
        const fileArrays = await Promise.all(migrationDirPaths.map(readDirAsync));
        const migrations = fileArrays
            .map(files => args.cmd === "commit" ? files[0] : files[1])
            .map((file, i) => resolve(migrationDirPaths[i], file));

        // concatenate the files together
        sql = await Promise.all(migrations.map(readFileAsync));
        sql = sql.reduce((sql, content) => sql.concat(content, "\n"), "");

    } catch(e) {
        console.error("Error reading SQL migration files. %s", e.toString());
        process.exit(1);
    }

    // declare the transaction client ahead of the try
    const transaction = await debugClient(pool);
    try {
        console.info("\nStarting %s...", args.cmd);
        // execute the migration transaction, updating the cursor
        await transaction.query("BEGIN");
        await transaction.query(sql);
        await transaction.query("UPDATE _migrations SET cursor = $1, completed = now()", [newCursor]);
        await transaction.query("COMMIT");
        console.info("\nMigration successful. Cursor now at: %s", dirNames[newCursor] || "clean");
    } catch(e) {
        await transaction.query("ROLLBACK");
        console.info("\nMigration unsuccessful - view the log above for details. Cursor remains unchanged");
        console.error(`Error during migration transaction: ${e.toString()}`);
        process.exit(1);
    } finally {
        transaction.release();
        process.exit();
    }
}

/*
* Helper functions
* */
// Prompt user for input
function promptUser() {
    return new Promise(res => {
        process.stdin.resume();
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", res);
    });
}

// Generate selection config from migration directory names
function spawnSelection(dirs) {
    return new Promise((res, rej) => {
        const select = require("select-shell")({ multiSelect: false });
        select.on("select", res);
        select.on("cancel", rej);
        dirs.forEach((d, i) => select.option(d, i));
        select.list();
    });
}

// Promisifed filesystem helpers
function readFileAsync(path) {
    return new Promise((res, rej) => {
        fs.readFile(path, "utf8", (err, data) => {
            if(err) return rej(err);
            return res(data);
        });
    });
}

function readDirAsync(dir) {
    return new Promise((res, rej) => {
        fs.readdir(dir, "utf8", (err, files) => {
            if(err) return rej(err);
            return res(files);
        });
    });
}

// Postgres client which logs all messages it receives
async function debugClient(pool) {
    const client = await pool.connect();
    client.connection.on("message", m => {
        if(m instanceof Error)
            return console.error("postgres[error:%s] %s", m.code, m.toString());
        if(!m.text) return;
        console.info("postgres[message:%s]", m.name, m.text || "message");
    });
    return client;
}

// Verify env vars are correct
function verifyEnv(pathToEnv) {
    let reasons = [];
    const pgVars = ["PGDATABASE", "PGHOST", "PGPASSWORD", "PGPORT", "PGUSER"];
    const varsNotPresent = pgVars.filter(pgv => !process.env[pgv] );
    if(varsNotPresent.length > 0)
        reasons.push(`Some pg environment variables are not present. Missing variables: ${varsNotPresent.join(", ")}`);

    const envPathExists = fs.existsSync(pathToEnv);
    if(!envPathExists)
        reasons.push(`No env file was found at path ${pathToEnv}`);

    return reasons;
}