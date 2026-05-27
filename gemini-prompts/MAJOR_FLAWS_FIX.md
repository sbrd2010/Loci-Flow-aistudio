# Loci App — Major Flaws Fix Request

You are working on the Loci Android ADHD productivity app built with Kotlin, Jetpack Compose,
MVVM architecture, Room database, and Firebase Realtime Database sync.

The full codebase is attached. Please implement ALL 8 fixes below in order.
Do not change any feature logic unless the fix specifically requires it.
After completing all changes, list every file that was modified or created.

---

## FIX 1 — Split LociScreen.kt into separate files

`app/src/main/java/com/example/ui/LociScreen.kt` is 2852 lines. This makes it fragile to edit.
Split it into the following new files, all in the same `com.example.ui` package.
Do not change any composable logic during this split — only move code and fix imports.

Create these files:

- **`LociScreen.kt`** — keep only `LociScreen()` composable (the main Scaffold, dialog visibility
  triggers, and the `when (viewModel.activeTab)` switch block)
- **`TodayTab.kt`** — move: `LociTodayTabContent`, `TodayHeaderStatistics`, `BrainDumpQuickCapture`,
  `ActiveFocusNowCard`, `TimeBlindnessTimelineSection`, `ActiveRitualProgressBanner`
- **`TaskRow.kt`** — move: `TaskCommitRow`, `CompletedTaskCommitRow`, `HorizonTaskPlanningItemRow`
- **`RoadmapTab.kt`** — move: `LociRoadmapTabContent`
- **`CoachTab.kt`** — move: `LociCoachTabContent`
- **`MentorTab.kt`** — move: `LociMentorTabContent`
- **`BentoGrid.kt`** — move: `ADHDContributionBentoWidget`
- **`Dialogs.kt`** — move: `StuckRescueDialog`, `OnboardingQuizDialog`, `SyncHubDialog`, `AddTaskDialog`
- **`BottomNav.kt`** — move: `BottomAppNavigationBar`, `NavigationBarItemCustom`

Ensure every new file has all required imports. Delete the moved composables from `LociScreen.kt`.

---

## FIX 2 — Fix Context memory leak in LociViewModel

In `LociViewModel.kt`:
- Change `class LociViewModel(private val repository: LociRepository, private val context: Context)`
  to extend `AndroidViewModel(application)` and accept `application: Application` as the second parameter
- Remove the `context: Context` constructor parameter
- Use `application` (or `application.applicationContext`) wherever `context` is currently used
  (this is only in the `LociSyncManager.sync(context, ...)` call)
- Update `LociViewModelFactory` to accept `Application` instead of `Context`
- In `MainActivity.kt`, change the factory instantiation to pass `application` instead of `this`

---

## FIX 3 — Fix the daily streak counter so it tracks real daily visits

Currently `visitStreakCount` is hardcoded at seed time and never updates.

In `LociViewModel.kt`, add a new private function `checkAndUpdateDailyStreak()`:
- Use Android `SharedPreferences` with the name `"loci_prefs"` and key `"last_visit_date"`
  to store the last visit date as a `"yyyy-MM-dd"` string
- Logic:
  - Get today as `"yyyy-MM-dd"`
  - Read `lastVisitDate` from SharedPreferences
  - If `lastVisitDate` is null: save today, set streak to 1
  - If `lastVisitDate` == today: do nothing (user already opened app today)
  - If `lastVisitDate` == yesterday: increment `config.visitStreakCount` by 1, save today
  - If `lastVisitDate` is older: reset streak to 1, save today
  - Save the updated config via `repository.saveConfig()`
- Call `checkAndUpdateDailyStreak()` inside the `init` block after the seeding `delay(200)` line,
  inside a new `viewModelScope.launch` block

---

## FIX 4 — Fix task deletions so they do not resurrect from Firebase after sync

When a task is deleted locally, the next Firebase sync currently pulls it back.
Fix this with a deletion tombstone system:

**Step A — Add new entity in `Entities.kt`:**
```kotlin
@Entity(tableName = "deleted_task_uuids")
data class DeletedTaskUuid(
    @PrimaryKey val uuid: String,
    val userId: String,
    val deletedAt: Long = System.currentTimeMillis()
)
```

**Step B — Add DAO methods in `Dao.kt`:**
```kotlin
@Insert(onConflict = OnConflictStrategy.REPLACE)
suspend fun insertDeletedUuid(entry: DeletedTaskUuid)

@Query("SELECT * FROM deleted_task_uuids WHERE userId = :userId")
suspend fun getDeletedUuidsForUser(userId: String): List<DeletedTaskUuid>
```

**Step C — Update `Database.kt`:**
- Add `DeletedTaskUuid::class` to the `entities` list
- Increment the database `version` by 1
- Add a `Migration` object from the old version to the new version that runs:
  `CREATE TABLE IF NOT EXISTS deleted_task_uuids (uuid TEXT NOT NULL PRIMARY KEY, userId TEXT NOT NULL, deletedAt INTEGER NOT NULL)`
- Replace `fallbackToDestructiveMigration()` with `.addMigrations(MIGRATION_X_Y)` (use correct version numbers)

**Step D — Add repository methods in `Repository.kt`:**
```kotlin
suspend fun recordDeletion(userId: String, uuid: String) =
    dao.insertDeletedUuid(DeletedTaskUuid(uuid = uuid, userId = userId))

suspend fun getDeletedUuids(userId: String): List<DeletedTaskUuid> =
    dao.getDeletedUuidsForUser(userId)
```

**Step E — Update `deleteTask()` in `LociViewModel.kt`:**
After `repository.deleteTask(task)`, add:
`repository.recordDeletion(currentUserEmail.value, task.uuid)`

**Step F — Update `LociSyncEngine.kt`:**
- Add `deletedUuids: List<String> = emptyList()` to the `SyncPayload` data class
- In the `sync()` function, after fetching local data, also fetch:
  `val localDeletedUuids = repository.getDeletedUuids(userId).map { it.uuid }`
- After building `taskMap` with the merge logic, add a filter step:
  `val combinedDeletedUuids = (localDeletedUuids + remotePayload.deletedUuids).toSet()`
  `val mergedTasks = taskMap.values.filter { it.uuid !in combinedDeletedUuids }`
- Include `deletedUuids = combinedDeletedUuids.toList()` in the `pushPayload`

---

## FIX 5 — Fix hardcoded "Amos" in mentor coaching quote

In `LociViewModel.kt`, in `updateMentoringLine()`, find this line:
```
"\"Quiet focus is a muscle, Amos. Protect this 25-minute space.\" — $name"
```
Replace the literal `Amos` with `${cur.userName}`:
```
"\"Quiet focus is a muscle, ${cur.userName}. Protect this 25-minute space.\" — $name"
```
Also scan the entire `updateMentoringLine()` function for any other hardcoded personal names
and replace them with `${cur.userName}`.

---

## FIX 6 — Fix HTTP logging to only run in debug builds

In `LociSyncEngine.kt`, inside the `getRetrofit()` function, change the OkHttpClient builder
so the logging interceptor is only added when `BuildConfig.DEBUG` is true:

```kotlin
val client = OkHttpClient.Builder()
    .connectTimeout(15, TimeUnit.SECONDS)
    .readTimeout(15, TimeUnit.SECONDS)
    .apply {
        if (com.example.BuildConfig.DEBUG) {
            addInterceptor(HttpLoggingInterceptor().apply {
                level = HttpLoggingInterceptor.Level.BODY
            })
        }
    }
    .build()
```

Remove the `logging` variable that was previously declared outside the builder.

---

## FIX 7 — Fix the onboarding so it actually collects user information

The current `OnboardingQuizDialog` shows a static welcome screen and does nothing functional.
Replace it with a 4-step onboarding flow. Keep it inside `OnboardingQuizDialog()` in `Dialogs.kt`
(after the file split from Fix 1).

Add a `var currentStep by remember { mutableStateOf(1) }` inside the dialog.

**Step 1 — Name:**
- Heading: "Welcome to Loci"
- Subtext: "A focus app built for ADHD brains."
- OutlinedTextField: label "What should Loci call you?"
- Store input in `var userName by remember { mutableStateOf("") }`
- "Next" button (enabled only if userName is not blank)

**Step 2 — Biggest challenge:**
- Heading: "What's your biggest challenge?"
- Four RadioButton options:
  - "Getting started on tasks" → maps to challengeType `"starting"`
  - "Staying focused once I start" → maps to `"focusing"`
  - "Following through to completion" → maps to `"execution"`
  - "Keeping track of time" → maps to `"tracking"`
- Store selection in `var selectedChallenge by remember { mutableStateOf("starting") }`
- "Next" button + "Back" button

**Step 3 — Mentor voice:**
- Heading: "Choose your mentor"
- Four RadioButton options: "Marcus Aurelius", "Yoda", "Seneca", "David Goggins"
- Store selection in `var selectedMentor by remember { mutableStateOf("Marcus Aurelius") }`
- "Next" button + "Back" button

**Step 4 — Confirmation:**
- Heading: "You're ready, [userName]"
- Show a summary card: their name, challenge label, and mentor name
- Single button: "Start My Focus Journey"
- On click: call `viewModel.updateProfileSettings(uName = userName, mName = selectedMentor, challenge = selectedChallenge, duration = 25, interval = 15, guard = true)`
  then call `viewModel.finishOnboarding()`

Show a linear progress indicator at the top showing step 1/4 through 4/4.

---

## FIX 8 — Implement actual push notifications for the nag reminder interval

The `reminderNagIntervalMinutes` setting exists in the UI but has no implementation. Add it.

**Step A — Add WorkManager dependency in `app/build.gradle.kts`:**
```kotlin
implementation(libs.androidx.work.runtime.ktx)
```
In `gradle/libs.versions.toml`, add the version and library entry for
`androidx.work:work-runtime-ktx:2.9.0` (or the latest stable version).

**Step B — Add notification permission to `AndroidManifest.xml`:**
```xml
<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>
```

**Step C — Create `app/src/main/java/com/example/data/LociReminderWorker.kt`:**
```kotlin
class LociReminderWorker(context: Context, params: WorkerParameters) :
    CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val channelId = "loci_reminders"
        val notificationManager = applicationContext
            .getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                channelId, "Loci Focus Reminders", NotificationManager.IMPORTANCE_DEFAULT
            ).apply { description = "Periodic nudges to check your focus task" }
            notificationManager.createNotificationChannel(channel)
        }

        val notification = NotificationCompat.Builder(applicationContext, channelId)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("Loci Check-in")
            .setContentText("Time to review your focus. What is your next small step?")
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .build()

        notificationManager.notify(1001, notification)
        return Result.success()
    }
}
```

**Step D — Add a `scheduleReminders(intervalMinutes: Int)` function in `LociViewModel.kt`:**
```kotlin
private fun scheduleReminders(intervalMinutes: Int) {
    val workManager = WorkManager.getInstance(application)
    workManager.cancelAllWorkByTag("loci_nag")
    val safeInterval = maxOf(intervalMinutes.toLong(), 15L)
    val request = PeriodicWorkRequestBuilder<LociReminderWorker>(
        safeInterval, TimeUnit.MINUTES
    ).addTag("loci_nag").build()
    workManager.enqueue(request)
}
```

**Step E — Wire it up:**
- Call `scheduleReminders(config.reminderNagIntervalMinutes)` inside the `init` block after config loads
- Call `scheduleReminders(interval)` at the end of `updateProfileSettings()`

Also request the `POST_NOTIFICATIONS` permission at runtime for Android 13+ in `MainActivity.kt`
using `ActivityCompat.requestPermissions()` on first launch.

---

After completing all 8 fixes, output a complete list of every file modified and every new file created.
