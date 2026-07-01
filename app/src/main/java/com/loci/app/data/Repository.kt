package com.loci.app.data

import kotlinx.coroutines.flow.Flow

class LociRepository(private val dao: LociDao) {
    fun getAllTasksForUser(userId: String): Flow<List<Task>> = dao.getAllTasksForUser(userId)
    fun getConfigForUser(userId: String): Flow<LociConfig?> = dao.getLociConfigForUser(userId)
    fun getContributionsForUser(userId: String): Flow<List<ContributionDay>> = dao.getContributionsForUser(userId)
    fun getChecklistItemsForUser(userId: String): Flow<List<TaskChecklistItem>> = dao.getChecklistItemsForUser(userId)

    suspend fun getTaskById(id: Int): Task? {
        return dao.getTaskById(id)
    }

    suspend fun insertTask(task: Task, updateTimestamp: Boolean = true) {
        val finalTask = if (updateTimestamp) task.copy(lastUpdated = System.currentTimeMillis()) else task
        dao.insertTask(finalTask)
    }

    suspend fun updateTask(task: Task, updateTimestamp: Boolean = true) {
        val finalTask = if (updateTimestamp) task.copy(lastUpdated = System.currentTimeMillis()) else task
        dao.updateTask(finalTask)
    }

    suspend fun deleteTask(task: Task) {
        dao.deleteTask(task)
    }

    suspend fun saveConfig(config: LociConfig, updateTimestamp: Boolean = true) {
        val finalConfig = if (updateTimestamp) config.copy(lastUpdated = System.currentTimeMillis()) else config
        dao.saveLociConfig(finalConfig)
    }

    suspend fun insertContribution(day: ContributionDay, updateTimestamp: Boolean = true) {
        val finalDay = if (updateTimestamp) day.copy(lastUpdated = System.currentTimeMillis()) else day
        dao.insertContribution(finalDay)
    }

    suspend fun insertChecklistItem(item: TaskChecklistItem, updateTimestamp: Boolean = true) {
        val finalItem = if (updateTimestamp) item.copy(lastUpdated = System.currentTimeMillis()) else item
        dao.insertChecklistItem(finalItem)
    }

    suspend fun updateChecklistItem(item: TaskChecklistItem, updateTimestamp: Boolean = true) {
        val finalItem = if (updateTimestamp) item.copy(lastUpdated = System.currentTimeMillis()) else item
        dao.updateChecklistItem(finalItem)
    }

    suspend fun getTasksSnapshotForUser(userId: String): List<Task> = dao.getTasksSnapshotForUser(userId)
    suspend fun getConfigSnapshotForUser(userId: String): LociConfig? = dao.getConfigSnapshotForUser(userId)
    suspend fun getContributionsSnapshotForUser(userId: String): List<ContributionDay> = dao.getContributionsSnapshotForUser(userId)
    suspend fun getChecklistItemsSnapshotForUser(userId: String): List<TaskChecklistItem> = dao.getChecklistItemsSnapshotForUser(userId)
    suspend fun deleteTaskByUuid(userId: String, uuid: String) = dao.deleteTaskByUuid(userId, uuid)
    suspend fun getTaskByUuid(userId: String, uuid: String): Task? = dao.getTaskByUuid(userId, uuid)

    suspend fun clearAllDataForUser(userId: String) {
        dao.deleteAllTasksForUser(userId)
        dao.deleteAllChecklistItemsForUser(userId)
    }
}
