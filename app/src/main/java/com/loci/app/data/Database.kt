package com.loci.app.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(entities = [Task::class, LociConfig::class, ContributionDay::class], version = 4, exportSchema = true)
abstract class LociDatabase : RoomDatabase() {
    abstract fun lociDao(): LociDao

    companion object {
        @Volatile
        private var INSTANCE: LociDatabase? = null

        /**
         * Room Database Migration guide for future schema changes:
         * 
         * 1. Increment the version number in the @Database annotation above (e.g., version = 5).
         * 2. Define a new migration object:
         *    val MIGRATION_4_5 = object : Migration(4, 5) {
         *        override fun migrate(db: SupportSQLiteDatabase) {
         *            // Execute SQL commands to update tables. Example of adding a new column:
         *            // db.execSQL("ALTER TABLE tasks ADD COLUMN priority INTEGER NOT NULL DEFAULT 0")
         *        }
         *    }
         * 3. Register the new migration in the builder below:
         *    .addMigrations(MIGRATION_3_4, MIGRATION_4_5)
         */
        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                // No-op migration for older database versions to ensure no-crash upgrades
            }
        }

        val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                // No-op migration for older database versions to ensure no-crash upgrades
            }
        }

        val MIGRATION_3_4 = object : Migration(3, 4) {
            override fun migrate(db: SupportSQLiteDatabase) {
                // No-op migration for now as requested. Schema remains matching v3,
                // which allows future schema changes to use proper SQL migration scripts
                // instead of destructive data deletion.
            }
        }

        fun getDatabase(context: Context): LociDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    LociDatabase::class.java,
                    "loci_database"
                )
                .addMigrations(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4)
                .build()
                INSTANCE = instance
                instance
            }
        }
    }
}
