package com.example.data

import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Dao
interface LociDao {
    @Query("SELECT * FROM tasks WHERE userId = :userId ORDER BY horizonLevel, orderIndex ASC")
    fun getAllTasksForUser(userId: String): Flow<List<Task>>

    @Query("SELECT * FROM tasks WHERE id = :id LIMIT 1")
    suspend fun getTaskById(id: Int): Task?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertTask(task: Task)

    @Update
    suspend fun updateTask(task: Task)

    @Delete
    suspend fun deleteTask(task: Task)

    @Query("DELETE FROM tasks WHERE userId = :userId")
    suspend fun deleteAllTasksForUser(userId: String)

    // Loci Config state
    @Query("SELECT * FROM loci_config WHERE userId = :userId LIMIT 1")
    fun getLociConfigForUser(userId: String): Flow<LociConfig?>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun saveLociConfig(config: LociConfig)

    @Query("SELECT * FROM tasks WHERE userId = :userId")
    suspend fun getTasksSnapshotForUser(userId: String): List<Task>

    @Query("SELECT * FROM loci_config WHERE userId = :userId LIMIT 1")
    suspend fun getConfigSnapshotForUser(userId: String): LociConfig?

    @Query("SELECT * FROM contributions WHERE userId = :userId")
    suspend fun getContributionsSnapshotForUser(userId: String): List<ContributionDay>

    @Query("DELETE FROM tasks WHERE userId = :userId AND uuid = :uuid")
    suspend fun deleteTaskByUuid(userId: String, uuid: String)

    @Query("SELECT * FROM tasks WHERE userId = :userId AND uuid = :uuid LIMIT 1")
    suspend fun getTaskByUuid(userId: String, uuid: String): Task?

    // Contributions grid
    @Query("SELECT * FROM contributions WHERE userId = :userId ORDER BY dateString ASC")
    fun getContributionsForUser(userId: String): Flow<List<ContributionDay>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertContribution(day: ContributionDay)
}
