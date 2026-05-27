package com.example.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(entities = [Task::class, LociConfig::class, ContributionDay::class], version = 3, exportSchema = false)
abstract class LociDatabase : RoomDatabase() {
    abstract fun lociDao(): LociDao

    companion object {
        @Volatile
        private var INSTANCE: LociDatabase? = null

        fun getDatabase(context: Context): LociDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    LociDatabase::class.java,
                    "loci_database"
                )
                .fallbackToDestructiveMigration()
                .build()
                INSTANCE = instance
                instance
            }
        }
    }
}
