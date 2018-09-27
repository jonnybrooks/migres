# migres
Dead simple database migrations for PostgreSQL

## Motivation
I've never been a huge fan of ORM-y solutions for database migrations - I like extremely simple setups, requiring little to no configuration, that do just what I need (and I can fill in the blanks if need be). This package essentially just automates what I had been doing by hand up til now.

## Usage
```
migres create   [-m path/to/migrations]
migres commit   [-m path/to/migrations] [-e path/to/.env] [-a]
migres rollback [-m path/to/migrations] [-e path/to/.env] [-a]
```

The flags are pretty simple:  


| Flag | Alias | Default | Description |
| ------------- | ------------- | ------------- | ------------- |
| -m  | --migrations  | "./postgres_migrations"  | (Optional) Path to the folder contaning all of the migration directories.  |
| -e | --env  | "./.env"  | (Optional) Path to a .env file to be consumed by dotenv. |
| -a | --all  | false  | (Optional) Commit / rollback to the furthest migration ahead / behind the current cursor, fast-forwarding past the selection menu. | 

All you have to do to get started is run:
```
migres create
```
And edit the `commit.sql` and `rollback.sql` files to reflect your schema changes. Create as few or as many migrations you want and, when you're done, run:
```
migres commit --all
```
And you're migrated!

## Notes
The cli won't let you accidently commit a migration you're already past, and it won't let you rollback a migration you're already behind - migres extracts the subset of migrations you can safely run without throwing any errors.

The script creates a `_migrations` table which keeps a cursor to the current point in the migration your database is at. There's nothing fancy like integrity checking with hashes, so it's more than possible to update your migrations on-the-fly. This might not be desirable for many. I intend on adding optional support for this in the future.
