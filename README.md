# migres
Dead simple database migrations for PostgreSQL

[![NPM](https://nodei.co/npm/migres.png)](https://nodei.co/npm/migres/)

## Motivation
I've never been a huge fan of ORM-y solutions for database migrations - I like extremely simple setups, requiring little to no configuration, that use pure SQL. This package essentially just automates what I had been doing by hand up til now, whilst adding some safeguards to prevent multiple redundant queries and errors of that nature.

## Setup
migres assumes that you already have postgres running, and that you already have a database instance to connect and migrate to.

In order to connect to the database instance itself, migres expects (in [node-postgres fashion](https://node-postgres.com/features/connecting)) that you set the following environment variables:

 - `PGDATABASE`
 - `PGHOST`
 - `PGPASSWORD`
 - `PGPORT`
 - `PGUSER`
 
migres has support for `.env` files out of the box by leveraging [`dotenv`](http://npmjs.com/dotenv). By default migres looks for a file named `.env` in the current directory when running, but this can be overriden as shown below.

## Usage
```
migres create   [-m path/to/migrations]
migres commit   [-m path/to/migrations] [-e path/to/.env] [-a]
migres rollback [-m path/to/migrations] [-e path/to/.env] [-a]
```

**Flags**

| Flag | Alias | Default | Description |
| ------------- | ------------- | ------------- | ------------- |
| `-m`  | `--migrations`  | `"./postgres_migrations"`  | (Optional) Path to the folder contaning all of the migration directories.  |
| `-e` | `--env`  | `"./.env"`  | (Optional) Path to a .env file to be consumed by dotenv. |
| `-a` | `--all`  | `false`  | (Optional) Commit / rollback to the furthest migration ahead / behind the current cursor, fast-forwarding past the selection menu. | 

If you have a `.env` file and a directory named `postgres_migratons` in your project root, all you have to do to get started is run:
```
migres create
```
And edit the `commit.sql` and `rollback.sql` files to reflect your schema changes. Create as few or as many migrations you want and, when you're done, run:
```
migres commit --all
```

And that's it!

## Notes
The cli won't let you accidently commit a migration you're already past, and it won't let you rollback a migration you're already behind - migres extracts the subset of migrations you can safely run without throwing any errors.

The script creates a `_migrations` table which keeps a cursor to the current point in the migration your database is at. There's nothing fancy like integrity checking with hashes, so it's more than possible to update your migrations on-the-fly. This might not be desirable for many. I intend on adding optional support for this in the future.
