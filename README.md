# migres
Dead simple database migrations for PostgreSQL

## Motivation
I've never been a huge fan of ORM-y solutions for database migrations - I like extremely simple setups, requiring little to no configuration, that do just what I need (and I can fill in the blanks if need be). 

This package essentially just automates what I had been doing by hand up til now. It has three commands:
```
migres create [path/to/migrations] [path/to/.env]
migres commit [path/to/migrations] [path/to/.env]
migres rollback [path/to/migrations] [path/to/.env]
```

It's as simple as creating a migration with `create`, editing the `commit.sql` and `rollback.sql` files, and then running the `commit` command. The script creates a `_migrations` table which keeps a cursor to the current point in the migration your database is at - nothing fancy like integrity checking with hashes, for now.

The cli won't let you accidently commit a migration you're already past, and it won't let you rollback a migration you're already behind - migres extracts the subset of migrations you can safely run without throwing any errors.
