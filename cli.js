#!/usr/bin/env node

// global requires
const {resolve} = require("path");
const fs = require("fs");
const {Pool} = require("pg");
const pool = new Pool();

// quit early if the arguments supplied are incorrect
if(process.argv.length < 3)
    throw new Error(
        "Incorrect usage of migrate. " +
        "Expected: create|commit|rollback [path/to/migrations] [/path/to/.env]"
    );

// run async business logic
(async function run() {

    // parse cli args
    const [,, cmd, migrations, dotenv] = process.argv;

    // get the full path to the migrations folder and initialise the dotenv config if there is one
    const pathToMigrations = resolve(process.cwd(), migrations || "postgres_migrations");
    const pathToEnv = resolve(process.cwd(), dotenv || ".env");
    require("dotenv").config({ path: pathToEnv });

    switch(cmd.toLowerCase()) {
        /*
        * Create a new migration
        * */
        case "create":
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
            if(fs.existsSync(newDir))
                throw new Error(`Migration: ${newDir} already exists`);

            // create the root migrations directory if it doesn't exist yet
            !fs.existsSync(pathToMigrations) && fs.mkdirSync(pathToMigrations);

            // make the directory and files
            fs.mkdirSync(newDir);
            fs.writeFileSync(resolve(newDir, `${migrationName}_commit.sql`), "");
            fs.writeFileSync(resolve(newDir, `${migrationName}_rollback.sql`), "");

            // pause stdin to cease execution
            process.stdin.pause();
            break;
        /*
        * Commit migrations up to a point selected by the user
        * */
        case "commit":
            await commitOrRollback({
                pathToMigrations,
                prompt: "Please select a migration point to commit up to:",
                cmd,
            });
            break;
        /*
        * Commit migrations up to a point selected by the user
        * */
        case "rollback":
            await commitOrRollback({
                pathToMigrations,
                prompt: "Please select a migration point to roll back past:",
                cmd,
            });
            break;
        default:
            throw new Error(`Command ${cmd} is not valid. Options: create, commit, rollback`);
    }
})();

/*
* Commit or roll back all migrations up to a migration selected by the user
* */
async function commitOrRollback({pathToMigrations, prompt, getDirSubsetFunc, cmd}) {

    // check if the migrations directory path is valid
    if(!fs.existsSync(pathToMigrations))
        throw new Error(`Directory at path: ${pathToMigrations} could not be found`);

    // create the migrations table and a cursor if it doesn't exist
    await pool.query(
        "CREATE TABLE IF NOT EXISTS _migrations(cursor int, completed date DEFAULT now());" +
        "INSERT INTO _migrations(cursor) SELECT -1 WHERE NOT exists(SELECT 1 FROM _migrations)"
    );

    // get the migration directories
    const dirNames = fs
        .readdirSync(pathToMigrations)
        .filter(subDir => !subDir.startsWith("."));

    // get the current migration cursor from the _migrations table
    const {rows} = await pool.query("SELECT cursor FROM _migrations");
    const cursor = rows && rows[0] ? rows[0].cursor : -1;

    console.info("Currently at: %s", dirNames[cursor] || "clean");

    // get the subset of applicable migrations for this database
    const subset = cmd === "commit"
        ? dirNames.slice(cursor + 1)
        : dirNames.slice(0).reverse().slice(dirNames.length - (cursor + 1));

    if(subset < 1) {
        const reason = cmd === "commit"
            ? "the database is already fully migrated"
            : "the database is already clean";
        console.error("Cannot perform %s: %s", cmd, reason);
        return process.exit();
    }

    // declare the transaction client ahead of the try
    const transaction = await debugClient();

    try {
        // prompt the user for input
        console.log(prompt);
        const [{value: selected}] = await spawnSelection(subset);
        const newCursor = cmd === "commit"
            ? dirNames.findIndex(d => d === subset[selected])
            : dirNames.findIndex(d => d === subset[selected]) - 1;

        // select the migration sql files up to the specified point
        const migrationDirPaths = subset
            .slice(0, selected + 1)
            .map(p => resolve(pathToMigrations, p));

        // create the migration file map
        const fileArrays = await Promise.all(migrationDirPaths.map(readDirAsync));
        const migrations = fileArrays
            .map(files => cmd === "commit" ? files[0] : files[1])
            .map((file, i) => resolve(migrationDirPaths[i], file));

        // concatenate the files together
        let sql = await Promise.all(migrations.map(readFileAsync));
        sql = sql.reduce((sql, content) => sql.concat(content, "\n"), "");

        // execute the migration transaction, updating the cursor
        await transaction.query("BEGIN");
        await transaction.query(sql);
        await transaction.query("UPDATE _migrations SET cursor = $1", [newCursor]);
        await transaction.query("COMMIT");
    } catch(e) {
        await transaction.query("ROLLBACK");
        console.error("Error occurred - exiting migration: %s", e);
    } finally {
        transaction.release();
        process.exit();
    }
}

/*
* Prompt user for input
* */
function promptUser() {
    return new Promise(res => {
        process.stdin.resume();
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", res);
    });
}

/*
* Generate selection config from migration directory names
* */
function spawnSelection(dirs) {
    return new Promise((res, rej) => {
        const select = require("select-shell")({ multiSelect: false });
        select.on("select", res);
        select.on("cancel", rej);
        dirs.forEach((d, i) => select.option(d, i));
        select.list();
    });
}

/*
* Promisifed filesystem helpers
* */
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

/*
* Postgres client which logs all messages it receives
* */
async function debugClient() {
    const client = await pool.connect();
    client.connection.on("message", m => {
        if(m instanceof Error)
            return console.error("postgres[error:%s] %s", m.code, m.toString());
        if(!m.text) return;
        console.info("postgres[message:%s]", m.name, m.text || "message");
    });
    return client;
}