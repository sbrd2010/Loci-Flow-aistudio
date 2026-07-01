package com.loci.app.data

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "tasks")
data class Task(
    @PrimaryKey(autoGenerate = true) val id: Int = 0,
    val userId: String = "husband@gmail.com", // Add partition
    val uuid: String = java.util.UUID.randomUUID().toString(), // Global unique sync ID
    val title: String,
    val concreteStep: String = "",
    val horizonLevel: String = "today", // today, week, month, quarter, halfyear, office
    val priority: String = "P3", // P1, P2, P3, P4
    val category: String = "Personal", // Career, Health, Work, Personal, etc.
    val timeEstimateMinutes: Int = 25,
    val deadlineTimestamp: Long? = null,
    val isCompleted: Boolean = false,
    val isParked: Boolean = false,
    val isNowFocus: Boolean = false,
    val orderIndex: Int = 0,
    val dateCompletedString: String? = null, // Format: YYYY-MM-DD for bento contribution grid
    val isDeleted: Boolean = false, // Soft-delete flag
    val lastUpdated: Long = System.currentTimeMillis() // Conflict resolution timestamp
)

@Entity(tableName = "task_checklist_items")
data class TaskChecklistItem(
    @PrimaryKey(autoGenerate = true) val id: Int = 0,
    val userId: String = "husband@gmail.com",
    val taskUuid: String,
    val uuid: String = java.util.UUID.randomUUID().toString(),
    val text: String,
    val isCompleted: Boolean = false,
    val orderIndex: Int = 0,
    val isDeleted: Boolean = false,
    val lastUpdated: Long = System.currentTimeMillis()
)

@Entity(tableName = "loci_config")
data class LociConfig(
    @PrimaryKey val userId: String = "husband@gmail.com", // Unique settings per account ID
    val userName: String = "Amos",
    val mentorName: String = "Marcus Aurelius",
    val challengeType: String = "starting", // starting, focusing, execution, tracking
    val pomodoroDurationMinutes: Int = 25,
    val reminderNagIntervalMinutes: Int = 15,
    val visitStreakCount: Int = 1,
    val lastVisitedTimestamp: Long = System.currentTimeMillis(),
    val totalXp: Int = 0,
    val intentionMessage: String = "Start tiny. One action. Right now.",
    val isLowEnergyMode: Boolean = false,
    val isOnboardingCompleted: Boolean = false,
    val eveningGuardWindowActive: Boolean = true,
    val lastUpdated: Long = System.currentTimeMillis() // Conflict resolution timestamp
)

@Entity(tableName = "contributions")
data class ContributionDay(
    @PrimaryKey val compositeKey: String = "husband@gmail.com_2026-05-27", // "userId_dateString"
    val userId: String = "husband@gmail.com",
    val dateString: String, // YYYY-MM-DD
    val count: Int = 0,
    val lastUpdated: Long = System.currentTimeMillis() // Conflict resolution timestamp
)

