package com.example.data

import android.content.Context
import android.util.Log
import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory
import retrofit2.http.*
import java.util.concurrent.TimeUnit

// Moshi payload structs
data class SyncPayload(
    val userId: String,
    val tasks: List<Task>,
    val config: LociConfig?,
    val contributions: List<ContributionDay>,
    val timestamp: Long = System.currentTimeMillis()
)

interface LociSyncApi {
    @GET("sync/{userId}")
    suspend fun pullData(
        @Path("userId") userId: String,
        @Header("Authorization") apiKey: String?
    ): SyncPayload

    @POST("sync/{userId}")
    suspend fun pushData(
        @Path("userId") userId: String,
        @Header("Authorization") apiKey: String?,
        @Body payload: SyncPayload
    ): SyncResponse
}

interface FirebaseSyncApi {
    @GET("sync/{userId}.json")
    suspend fun pullData(
        @Path("userId") userId: String,
        @Query("auth") apiKey: String?
    ): SyncPayload?

    @PUT("sync/{userId}.json")
    suspend fun pushData(
        @Path("userId") userId: String,
        @Query("auth") apiKey: String?,
        @Body payload: SyncPayload
    ): SyncPayload
}

data class SyncResponse(
    val success: Boolean,
    val message: String,
    val remoteTimestamp: Long
)

object LociSyncManager {
    private const val TAG = "LociSyncManager"

    private fun getDatabaseSecretsKey(): String {
        return try {
            val key = com.example.BuildConfig.DATABASE_SECRETS_KEY
            if (key == null || key == "DATABASE_SECRETS_KEY_PLACEHOLDER") "" else key
        } catch (e: Throwable) {
            ""
        }
    }

    // Configuration states that can be configured dynamically by the user in-app
    var cloudServerUrl: String = if (getDatabaseSecretsKey().isNotEmpty()) {
        "https://loci-flow-default-rtdb.firebaseio.com/"
    } else {
        "https://loci-sync.free.beeceptor.com/api/" // Default demo endpoint
    }
    
    var cloudApiKey: String = getDatabaseSecretsKey()

    private fun getRetrofit(baseUrl: String): Retrofit {
        // Sanitize trailing slash for Retrofit
        val sanitizedUrl = if (baseUrl.endsWith("/")) baseUrl else "$baseUrl/"

        val logging = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BODY
        }

        val client = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .addInterceptor(logging)
            .build()

        val moshi = Moshi.Builder()
            .addLast(KotlinJsonAdapterFactory())
            .build()

        return Retrofit.Builder()
            .baseUrl(sanitizedUrl)
            .client(client)
            .addConverterFactory(MoshiConverterFactory.create(moshi))
            .build()
    }

    /**
     * Executes real cloud synchronization:
     * 1. Pulls remote snapshot from cloud server
     * 2. Fetches local snapshot from Room
     * 3. Merges them row-by-row based on 'lastUpdated' timestamps (conflict-free conflict resolution)
     * 4. Persists the merged set locally to Room
     * 5. Pushes the consolidated merged set back to the cloud
     */
    suspend fun sync(context: Context, repository: LociRepository, userId: String): SyncResult = withContext(Dispatchers.IO) {
        try {
            val database = LociDatabase.getDatabase(context)

            // 1. Fetch local snapshot
            val localTasks = repository.getTasksSnapshotForUser(userId)
            val localConfig = repository.getConfigSnapshotForUser(userId)
            val localContributions = repository.getContributionsSnapshotForUser(userId)

            val currentUrl = cloudServerUrl.trim()
            if (currentUrl.isEmpty() || !currentUrl.startsWith("http")) {
                return@withContext SyncResult.Error("Invalid Endpoint URL. Must start with http:// or https://")
            }

            // Clean userId for Firebase paths (replace dots, etc., if necessary, but emails contain dots.
            // Safe URL encoding/escapes are standard, but the REST API path is fine with standard URL-encoded strings)
            val safeUserId = userId.replace(".", "_") // Firebase paths are simple keys; dots can cause nesting, so using _ is much safer!

            val isFirebase = currentUrl.contains("firebaseio.com") || currentUrl.contains("firebasedatabase.app")
            Log.d(TAG, "Syncing for $userId (${if (isFirebase) "Firebase path: $safeUserId" else "Custom Server"}) from $currentUrl")

            // 2. Fetch remote snapshot
            val remotePayload: SyncPayload = if (isFirebase) {
                val fbApi = getRetrofit(currentUrl).create(FirebaseSyncApi::class.java)
                val fbAuth = if (cloudApiKey.isNotEmpty()) cloudApiKey else null
                try {
                    val result = fbApi.pullData(safeUserId, fbAuth)
                    result ?: SyncPayload(userId, emptyList(), null, emptyList())
                } catch (e: Exception) {
                    Log.e(TAG, "Firebase pull failed, acting as new database", e)
                    SyncPayload(userId, emptyList(), null, emptyList())
                }
            } else {
                val api = getRetrofit(currentUrl).create(LociSyncApi::class.java)
                val authHeader = if (cloudApiKey.isNotEmpty()) "Bearer $cloudApiKey" else null
                try {
                    api.pullData(userId, authHeader)
                } catch (e: retrofit2.HttpException) {
                    if (e.code() == 404) {
                        SyncPayload(userId, emptyList(), null, emptyList())
                    } else {
                        throw e
                    }
                } catch (e: java.io.FileNotFoundException) {
                    SyncPayload(userId, emptyList(), null, emptyList())
                }
            }

            Log.d(TAG, "Success pulls remote delta. Merging datasets...")

            // 3. Merging logic
            // Merge Configuration settings
            val mergedConfig: LociConfig = if (localConfig == null) {
                remotePayload.config ?: LociConfig(userId = userId, lastUpdated = System.currentTimeMillis())
            } else if (remotePayload.config == null) {
                localConfig
            } else {
                if (localConfig.lastUpdated >= remotePayload.config.lastUpdated) localConfig else remotePayload.config
            }

            // Merge Tasks
            val taskMap = mutableMapOf<String, Task>()
            // Populate remote tasks
            remotePayload.tasks.forEach { remoteTask ->
                taskMap[remoteTask.uuid] = remoteTask
            }
            // Overwrite with newer local tasks
            localTasks.forEach { localTask ->
                val matchingRemote = taskMap[localTask.uuid]
                if (matchingRemote == null) {
                    taskMap[localTask.uuid] = localTask
                } else {
                    if (localTask.lastUpdated >= matchingRemote.lastUpdated) {
                        // Crucial: keep local task's autogenerated database 'id' so Room updates it rather than insert a duplicate row!
                        taskMap[localTask.uuid] = localTask.copy(id = matchingRemote.id)
                    } else {
                        // Crucial: keep the remote task but transfer the local database ID
                        taskMap[localTask.uuid] = matchingRemote.copy(id = localTask.id)
                    }
                }
            }
            val mergedTasks = taskMap.values.toList()

            // Merge ContributionDays
            val contributionMap = mutableMapOf<String, ContributionDay>()
            remotePayload.contributions.forEach { remoteCont ->
                contributionMap[remoteCont.compositeKey] = remoteCont
            }
            localContributions.forEach { localCont ->
                val matchingRemote = contributionMap[localCont.compositeKey]
                if (matchingRemote == null) {
                    contributionMap[localCont.compositeKey] = localCont
                } else {
                    if (localCont.lastUpdated >= matchingRemote.lastUpdated) {
                        contributionMap[localCont.compositeKey] = localCont
                    } else {
                        contributionMap[localCont.compositeKey] = matchingRemote
                    }
                }
            }
            val mergedContributions = contributionMap.values.toList()

            // 4. Save merged set back to local Room database
            repository.saveConfig(mergedConfig, updateTimestamp = false)

            // Sync tasks
            for (task in mergedTasks) {
                repository.insertTask(task, updateTimestamp = false)
            }

            // Sync contributions
            for (cont in mergedContributions) {
                repository.insertContribution(cont, updateTimestamp = false)
            }

            // 5. Build output consolidation payload & push back to remote server
            val pushPayload = SyncPayload(
                userId = userId,
                tasks = mergedTasks,
                config = mergedConfig,
                contributions = mergedContributions
            )

            Log.d(TAG, "Pushing consolidated sync payload to $currentUrl")
            if (isFirebase) {
                val fbApi = getRetrofit(currentUrl).create(FirebaseSyncApi::class.java)
                val fbAuth = if (cloudApiKey.isNotEmpty()) cloudApiKey else null
                fbApi.pushData(safeUserId, fbAuth, pushPayload)
                SyncResult.Success(
                    insertedCount = mergedTasks.size,
                    message = "Successfully synchronized with Firebase Database! Live revision synced for account profile: $userId"
                )
            } else {
                val api = getRetrofit(currentUrl).create(LociSyncApi::class.java)
                val authHeader = if (cloudApiKey.isNotEmpty()) "Bearer $cloudApiKey" else null
                val pRes = api.pushData(userId, authHeader, pushPayload)

                if (pRes.success) {
                    SyncResult.Success(
                        insertedCount = mergedTasks.size,
                        message = "Successfully synchronized with cloud backend! Live revision synced for account profile: $userId"
                    )
                } else {
                    SyncResult.Error(pRes.message)
                }
            }

        } catch (e: Exception) {
            Log.e(TAG, "Sync process failed", e)
            val errorMessage = e.localizedMessage ?: e.message ?: "Unknown socket timeout or network error"
            SyncResult.Error(errorMessage)
        }
    }
}

sealed class SyncResult {
    data class Success(val insertedCount: Int, val message: String) : SyncResult()
    data class Error(val reason: String) : SyncResult()
}
