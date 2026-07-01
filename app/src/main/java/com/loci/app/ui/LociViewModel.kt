package com.loci.app.ui

import android.app.Application
import android.content.Context
import androidx.compose.runtime.*
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.loci.app.data.*
import com.google.ai.client.generativeai.GenerativeModel
import com.squareup.moshi.Moshi
import com.squareup.moshi.Types
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import kotlinx.coroutines.ExperimentalCoroutinesApi
import java.text.SimpleDateFormat
import java.util.*

enum class LociTab {
    Today, Roadmap, Coach, Mentor
}

class LociViewModel(
    private val repository: LociRepository,
    application: Application
) : AndroidViewModel(application) {

    private val context: Context = getApplication()

    // Active user partitioning
    val currentUserEmail = MutableStateFlow("husband@gmail.com")

    // Cloud synchronization simulator state
    var isAutoSyncEnabled by mutableStateOf(true)
    var syncStatusMessage by mutableStateOf("In Sync")
    var isSyncingNow by mutableStateOf(false)
    var lastSyncSuccessfulTimestamp by mutableStateOf(System.currentTimeMillis())

    fun checkAutoSync() {
        if (isAutoSyncEnabled) {
            triggerCloudSyncAnimation()
        }
    }

    fun triggerCloudSyncAnimation(onComplete: () -> Unit = {}) {
        viewModelScope.launch {
            isSyncingNow = true
            syncStatusMessage = "Syncing with cloud database..."
            
            val result = LociSyncManager.sync(context, repository, currentUserEmail.value)
            
            when (result) {
                is SyncResult.Success -> {
                    lastSyncSuccessfulTimestamp = System.currentTimeMillis()
                    syncStatusMessage = "In Sync"
                }
                is SyncResult.Error -> {
                    syncStatusMessage = "Sync Offline: ${result.reason}"
                }
            }
            isSyncingNow = false
            onComplete()
        }
    }

    // Tab Navigation
    var activeTab by mutableStateOf(LociTab.Today)
        private set

    fun selectTab(tab: LociTab) {
        activeTab = tab
    }

    // Active Level representation in Strategic Horizon planning board
    // "today", "week", "month", "quarter", "halfyear", "office"
    var activeHorizonLevel by mutableStateOf("today")
        private set

    fun selectHorizonLevel(level: String) {
        activeHorizonLevel = level
    }

    // Observe Room entities reactively partitioned by current user selection
    @OptIn(ExperimentalCoroutinesApi::class)
    val tasks: StateFlow<List<Task>> = currentUserEmail
        .flatMapLatest { email -> repository.getAllTasksForUser(email) }
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5000),
            initialValue = emptyList()
        )

    @OptIn(ExperimentalCoroutinesApi::class)
    val config: StateFlow<LociConfig?> = currentUserEmail
        .flatMapLatest { email -> repository.getConfigForUser(email) }
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5000),
            initialValue = null
        )

    @OptIn(ExperimentalCoroutinesApi::class)
    val contributions: StateFlow<List<ContributionDay>> = currentUserEmail
        .flatMapLatest { email -> repository.getContributionsForUser(email) }
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5000),
            initialValue = emptyList()
        )

    // Current State for Active Pomodoro / Focus Timer
    var isTimerRunning by mutableStateOf(false)
        private set
    var timerSecondsLeft by mutableStateOf(25 * 60)
        private set
    var timerMaxSeconds by mutableStateOf(25 * 60)
        private set

    private var timerJob: Job? = null

    // Mentoring feedback line below task
    var mentoringQuote by mutableStateOf("Start tiny. One action. Right now.")
        private set

    // Onboarding UI step
    var onboardingStep by mutableStateOf(0) // 0 means not showing unless not completed
    var showOnboarding by mutableStateOf(false)

    // Chat with AI Mentor state
    var chatHistory = mutableStateListOf<Pair<String, Boolean>>() // message to isUser
    var chatInputText by mutableStateOf("")
    var isChatLoading by mutableStateOf(false)
        private set

    // AI Weekly Review state
    var isWeeklyReviewLoading by mutableStateOf(false)
        private set
    var weeklyReviewSuggestion by mutableStateOf("")
        private set

    // Stuck rescue mode sheet helper
    var showStuckRescueDialog by mutableStateOf(false)
    var showSyncHubDialog by mutableStateOf(false) // Trigger floating sync & account portal
    var rescueCurrentStepIndex by mutableStateOf(0)
    val rescueSteps = listOf(
        "Take one deep breath. Closed eyes. Breathe in for 4, hold for 4, out for 4.",
        "What is the absolute, laughably smallest first step? Writing a single sentence count as a step.",
        "Close all browser tabs that aren't this single task right now.",
        "Commit to doing this tiny action for just 2 minutes. If you want to stop then, you can."
    )

    // Morning ritual active step
    var activeRitualStepIndex by mutableStateOf(-1) // -1 means ritual inactive
    val ritualSteps = listOf(
        "Drink a full glass of water (Hydrate)" to 60,
        "Stretch for 2 minutes (Move)" to 120,
        "Free-form Mind dump (Clear brain)" to 180,
        "Pick your top P1 commitment today (Focus)" to 90
    )
    var ritualSecondsRemaining by mutableStateOf(0)
    private var ritualJob: Job? = null

    // Time progress
    var currentDayTimelineProgress by mutableStateOf(0f)

    init {
        val isUnitTest = try {
            Class.forName("org.robolectric.Robolectric") != null
        } catch (e: ClassNotFoundException) {
            false
        }

        // Run periodic updates
        if (!isUnitTest) {
            viewModelScope.launch {
                try {
                    while (true) {
                        updateDayTimelineProgress()
                        delay(60000) // update every minute
                    }
                } catch (e: Throwable) {
                    android.util.Log.e("LociViewModel", "Timeline updater stopped", e)
                }
            }
        } else {
            // Under unit-test, just update once to populate the state
            updateDayTimelineProgress()
        }

        // Initialize default pre-seeded accounts for Amos (husband) and Sarah (wife)
        viewModelScope.launch {
            try {
                // Automatically sign in anonymously using FirebaseAuth before seeding starts
                android.util.Log.d("LociViewModel", "Starting FirebaseAuth anonymous sign-in...")
                kotlinx.coroutines.withTimeoutOrNull(2000) {
                    suspendSignInAnonymously()
                }

                // Seed the primary husband account sequentially
                seedUser("husband@gmail.com", "Amos", "Marcus Aurelius")
                // Seed the secondary wife account sequentially
                seedUser("wife@gmail.com", "Sarah", "Yoda")

                // Wait a moment for seeding transactions to settle, then load initial config details
                delay(200)
                val existing = repository.getConfigForUser(currentUserEmail.value).firstOrNull()
                if (existing != null) {
                    val updatedConfig = checkAndUpdateStreak(existing)
                    repository.saveConfig(updatedConfig)
                    timerSecondsLeft = updatedConfig.pomodoroDurationMinutes * 60
                    timerMaxSeconds = updatedConfig.pomodoroDurationMinutes * 60
                } else {
                    showOnboarding = true
                }
                updateMentoringLine()
                triggerCloudSyncAnimation()
            } catch (e: Throwable) {
                android.util.Log.e("LociViewModel", "Init configuration profiles failed", e)
            }
        }
    }

    private suspend fun suspendSignInAnonymously() = kotlinx.coroutines.suspendCancellableCoroutine<Boolean> { continuation ->
        try {
            // Programmatically initialize FirebaseApp if it's not initialized yet
            if (com.google.firebase.FirebaseApp.getApps(context).isEmpty()) {
                android.util.Log.i("LociViewModel", "Initializing FirebaseApp programmatically...")
                val options = com.google.firebase.FirebaseOptions.Builder()
                    .setApplicationId("1:862993748883:android:9e4865e4977f8a8f80ce66")
                    .setApiKey("AIzaSyDKCF2WcJk9kI1YovHBTPrWj2QSdmrjUx0")
                    .setProjectId("loci-flow")
                    .build()
                com.google.firebase.FirebaseApp.initializeApp(context.applicationContext, options)
                android.util.Log.i("LociViewModel", "FirebaseApp programmatically initialized successfully.")
            }
        } catch (e: Throwable) {
            android.util.Log.w("LociViewModel", "Failed to programmatically initialize FirebaseApp, skipping active auth sync: ${e.message}")
        }

        try {
            val auth = com.google.firebase.auth.FirebaseAuth.getInstance()
            auth.signInAnonymously()
                .addOnCompleteListener { task ->
                    if (continuation.isActive) {
                        if (task.isSuccessful) {
                            android.util.Log.i("LociViewModel", "FirebaseAuth anonymous sign-in successful: ${task.result?.user?.uid}")
                            continuation.resumeWith(Result.success(true))
                        } else {
                            android.util.Log.e("LociViewModel", "FirebaseAuth anonymous sign-in failed", task.exception)
                            continuation.resumeWith(Result.success(false))
                        }
                    }
                }
        } catch (e: IllegalStateException) {
            android.util.Log.w("LociViewModel", "FirebaseApp not initialized. Skipping anonymous sign-in (unit-test/local mode).")
            if (continuation.isActive) {
                continuation.resumeWith(Result.success(false))
            }
        } catch (e: Throwable) {
            android.util.Log.e("LociViewModel", "FirebaseAuth anonymous sign-in exception", e)
            if (continuation.isActive) {
                continuation.resumeWith(Result.success(false))
            }
        }
    }

    // Seeding logic to populate offline database workspace profiles
    suspend fun seedUser(email: String, name: String, mentor: String) {
        try {
            val existing = repository.getConfigForUser(email).firstOrNull()
            if (existing == null) {
                val initConfig = LociConfig(
                    userId = email,
                    userName = name,
                    mentorName = mentor,
                    totalXp = if (email == "husband@gmail.com") 150 else 80,
                    visitStreakCount = if (email == "husband@gmail.com") 5 else 3,
                    isOnboardingCompleted = true
                )
                repository.saveConfig(initConfig)

                // Seed user-specific tasks to make their profiles distinctive
                val sampleTasks = if (email == "husband@gmail.com") {
                    listOf(
                        Task(userId = email, title = "Optimize resume for tech product role", concreteStep = "Add metric metrics to job #1", horizonLevel = "today", priority = "P1", category = "Career", timeEstimateMinutes = 45, orderIndex = 0),
                        Task(userId = email, title = "Prep interview answers for star technique", concreteStep = "Draft situation for leadership quest", horizonLevel = "today", priority = "P2", category = "Career", timeEstimateMinutes = 30, orderIndex = 1),
                        Task(userId = email, title = "Go for a brief outdoor walk to recharge dopamine", concreteStep = "Put on sneakers and walk 10 mins", horizonLevel = "today", priority = "P4", category = "Health", timeEstimateMinutes = 15, orderIndex = 2),
                        Task(userId = email, title = "Sync up with reference contact", concreteStep = "Write initial short linkedin ping", horizonLevel = "week", priority = "P3", category = "Career", timeEstimateMinutes = 20, orderIndex = 3),
                        Task(userId = email, title = "Complete draft budget analysis", concreteStep = "Export spreadsheet from active credit", horizonLevel = "office", priority = "P3", category = "Work", timeEstimateMinutes = 60, orderIndex = 4)
                    )
                } else {
                    listOf(
                        Task(userId = email, title = "Wife's Focus: Complete client visual presentation slides", concreteStep = "Insert three core product user study charts", horizonLevel = "today", priority = "P1", category = "Work", timeEstimateMinutes = 35, orderIndex = 0),
                        Task(userId = email, title = "Coordinate quarterly family calendar & schedules", concreteStep = "Align and push dates into synced drive", horizonLevel = "today", priority = "P2", category = "Personal", timeEstimateMinutes = 20, orderIndex = 1),
                        Task(userId = email, title = "Daily yoga flow & mindfulness breathing series", concreteStep = "Roll out primary high-grip mat near screen", horizonLevel = "today", priority = "P4", category = "Health", timeEstimateMinutes = 15, orderIndex = 2),
                        Task(userId = email, title = "Review and draft quarterly home budget markers", concreteStep = "Itemize groceries, utilities, and retirement allocations", horizonLevel = "week", priority = "P3", category = "Personal", timeEstimateMinutes = 45, orderIndex = 3)
                    )
                }
                for (task in sampleTasks) {
                    repository.insertTask(task)
                }

                // Seed realistic contributions grid days
                for (i in 1..8) {
                    val dateStr = getPastDateString(i)
                    repository.insertContribution(ContributionDay(
                        compositeKey = "${email}_$dateStr",
                        userId = email,
                        dateString = dateStr,
                        count = (1..4).random()
                    ))
                }
            }
        } catch (e: Throwable) {
            android.util.Log.e("LociViewModel", "Fails to seed profile context for $email", e)
        }
    }

    private fun checkAndUpdateStreak(config: LociConfig): LociConfig {
        val lastVisited = config.lastVisitedTimestamp
        val now = System.currentTimeMillis()
        
        val lastCal = Calendar.getInstance().apply { timeInMillis = lastVisited }
        val nowCal = Calendar.getInstance().apply { timeInMillis = now }

        val lastYear = lastCal.get(Calendar.YEAR)
        val lastDay = lastCal.get(Calendar.DAY_OF_YEAR)
        
        val nowYear = nowCal.get(Calendar.YEAR)
        val nowDay = nowCal.get(Calendar.DAY_OF_YEAR)

        fun getAbsoluteDay(cal: Calendar): Int {
            var days = cal.get(Calendar.DAY_OF_YEAR)
            val year = cal.get(Calendar.YEAR)
            for (y in 1970 until year) {
                val isLeap = (y % 4 == 0 && y % 100 != 0) || (y % 400 == 0)
                days += if (isLeap) 366 else 365
            }
            return days
        }

        val lastAbsoluteDay = getAbsoluteDay(lastCal)
        val nowAbsoluteDay = getAbsoluteDay(nowCal)
        val dayDiff = nowAbsoluteDay - lastAbsoluteDay

        val newStreakCount = when {
            dayDiff <= 0 -> config.visitStreakCount // Same day or local clock went backward, preserve
            dayDiff == 1 -> config.visitStreakCount + 1 // Consecutive day, increment!
            else -> 1 // Gap of 2 or more days, reset!
        }

        return config.copy(
            visitStreakCount = newStreakCount,
            lastVisitedTimestamp = now
        )
    }

    // Account switching utility
    fun selectUserAccount(email: String) {
        viewModelScope.launch {
            try {
                // Cancel active timers or routines on user swap
                pauseFocusTimer()
                stopMorningRitual()

                currentUserEmail.value = email

                // If account is custom/not seeded, seed it dynamically
                val existing = repository.getConfigForUser(email).firstOrNull()
                if (existing == null) {
                    val shortName = email.substringBefore("@").replaceFirstChar { it.uppercase() }
                    seedUser(email, shortName, "Marcus Aurelius")
                    // Wait briefly for seeding transactions to settle
                    delay(200)
                    val freshlySeeded = repository.getConfigForUser(email).firstOrNull()
                    if (freshlySeeded != null) {
                        val updatedConfig = checkAndUpdateStreak(freshlySeeded)
                        repository.saveConfig(updatedConfig)
                        timerSecondsLeft = updatedConfig.pomodoroDurationMinutes * 60
                        timerMaxSeconds = updatedConfig.pomodoroDurationMinutes * 60
                    }
                } else {
                    val updatedConfig = checkAndUpdateStreak(existing)
                    repository.saveConfig(updatedConfig)
                    timerSecondsLeft = updatedConfig.pomodoroDurationMinutes * 60
                    timerMaxSeconds = updatedConfig.pomodoroDurationMinutes * 60
                }
                updateMentoringLine()
                triggerCloudSyncAnimation()
            } catch (e: Throwable) {
                android.util.Log.e("LociViewModel", "Failed to switch user account", e)
            }
        }
    }

    private fun getPastDateString(daysAgo: Int): String {
        val calendar = Calendar.getInstance()
        calendar.add(Calendar.DAY_OF_YEAR, -daysAgo)
        val sdf = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
        return sdf.format(calendar.time)
    }

    private fun updateDayTimelineProgress() {
        val calendar = Calendar.getInstance()
        val hour = calendar.get(Calendar.HOUR_OF_DAY)
        val minute = calendar.get(Calendar.MINUTE)

        // Day boundaries defined as 7 AM to 2 AM next day (19 hours total)
        val startHour = 7
        val endHour = 26 // 2 AM is 26 hours from yesterday's start

        val currentHourFloat = hour + (minute / 60f)
        val adjustedHour = if (hour < 7) currentHourFloat + 24 else currentHourFloat

        val progress = (adjustedHour - startHour) / (endHour - startHour)
        currentDayTimelineProgress = progress.coerceIn(0f, 1f)
    }

    // Start or Pause Pomodoro Focus Clock
    fun toggleFocusTimer() {
        if (isTimerRunning) {
            pauseFocusTimer()
        } else {
            startFocusTimer()
        }
    }

    private fun startFocusTimer() {
        isTimerRunning = true
        timerJob = viewModelScope.launch {
            while (timerSecondsLeft > 0) {
                delay(1000)
                timerSecondsLeft--
            }
            // Timer finished!
            isTimerRunning = false
            triggerTimerCompletionBonus()
        }
    }

    fun pauseFocusTimer() {
        isTimerRunning = false
        timerJob?.cancel()
    }

    fun resetFocusTimer(minutes: Int) {
        pauseFocusTimer()
        timerMaxSeconds = minutes * 60
        timerSecondsLeft = timerMaxSeconds
    }

    private fun triggerTimerCompletionBonus() {
        // Complete current focus task if pinned and add 120 XP points
        viewModelScope.launch {
            val active = tasks.value.firstOrNull { it.isNowFocus }
            if (active != null) {
                completeTask(active)
            } else {
                addXpScore(50)
            }
            updateMentoringLine()
        }
    }

    fun addXpScore(points: Int) {
        viewModelScope.launch {
            val email = currentUserEmail.value
            val current = config.value ?: return@launch
            val updated = current.copy(totalXp = current.totalXp + points)
            repository.saveConfig(updated)
            recordTodayContribution()
            if (isAutoSyncEnabled) {
                triggerCloudSyncAnimation()
            }
        }
    }

    private suspend fun recordTodayContribution() {
        val email = currentUserEmail.value
        val sdf = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
        val dateStr = sdf.format(Date())
        val list = contributions.value
        val existing = list.firstOrNull { it.dateString == dateStr }
        val compositeKey = "${email}_$dateStr"
        if (existing == null) {
            repository.insertContribution(ContributionDay(compositeKey, email, dateStr, 1))
        } else {
            repository.insertContribution(ContributionDay(compositeKey, email, dateStr, existing.count + 1))
        }
    }

    // Toggle ADHD Energy modes
    fun toggleLowEnergyFilter() {
        viewModelScope.launch {
            val email = currentUserEmail.value
            val cur = config.value ?: return@launch
            val updated = cur.copy(isLowEnergyMode = !cur.isLowEnergyMode)
            repository.saveConfig(updated)
            if (isAutoSyncEnabled) {
                triggerCloudSyncAnimation()
            }
        }
    }

    // Update settings
    fun updateProfileSettings(uName: String, mName: String, challenge: String, duration: Int, interval: Int, guard: Boolean) {
        viewModelScope.launch {
            val email = currentUserEmail.value
            val cur = config.value ?: LociConfig(userId = email)
            val updated = cur.copy(
                userName = uName,
                mentorName = mName,
                challengeType = challenge,
                pomodoroDurationMinutes = duration,
                reminderNagIntervalMinutes = interval,
                eveningGuardWindowActive = guard
            )
            repository.saveConfig(updated)
            // Synchronize active timer minutes
            resetFocusTimer(duration)
            updateMentoringLine()
            if (isAutoSyncEnabled) {
                triggerCloudSyncAnimation()
            }
        }
    }

    // Context-dependent Coaching Mentor dialogue
    fun updateMentoringLine() {
        val cur = config.value ?: return
        val itemsDone = tasks.value.count { it.horizonLevel == "today" && it.isCompleted }
        val name = cur.mentorName
        val challenge = cur.challengeType
        val isLowEnergy = cur.isLowEnergyMode

        viewModelScope.launch {
            val energyText = if (isLowEnergy) "Low Energy Mode" else "Standard Energy"
            val prompt = """
                You are ${name}, the user's ADHD coach. 
                Generate a short, powerful, hyper-personalized encouraging coaching statement for the user.
                User state:
                - Principal Challenge: ${challenge}
                - Today tasks completed: ${itemsDone}
                - Energy level: ${energyText}
                
                Keep the text ultra-focused, under 18 words, in quotes, followed by "— ${name}".
                Do not explain. Return ONLY the quote.
                Example: "Starting is the hardest part. Just open the page. — ${name}"
            """.trimIndent()

            val quote = LociAiEngine.generate(prompt).trim()
            if (quote.isNotEmpty()) {
                mentoringQuote = quote
            } else {
                mentoringQuote = "\"Starting sits in your prefrontal cortex. Don't plan. Just draft 5 words.\" — ${name}"
            }
        }
    }

    // Complete Onboarding
    fun finishOnboarding() {
        viewModelScope.launch {
            val cur = config.value ?: LociConfig()
            repository.saveConfig(cur.copy(isOnboardingCompleted = true))
            showOnboarding = false
        }
    }

    // Task Actions
    fun pinTaskToFocus(task: Task) {
        viewModelScope.launch {
            // Unpin all first
            tasks.value.forEach {
                if (it.isNowFocus) {
                    repository.updateTask(it.copy(isNowFocus = false))
                }
            }
            // Pin target
            repository.updateTask(task.copy(isNowFocus = true, isParked = false))
            // Synchronize Pomodoro timer duration
            resetFocusTimer(task.timeEstimateMinutes)
            updateMentoringLine()
            checkAutoSync()
        }
    }

    fun completeTask(task: Task) {
        viewModelScope.launch {
            val dateStr = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(Date())
            repository.updateTask(task.copy(isCompleted = true, isNowFocus = false, dateCompletedString = dateStr))
            addXpScore(100)
            updateMentoringLine()
            checkAutoSync()
        }
    }

    fun uncompleteTask(task: Task) {
        viewModelScope.launch {
            repository.updateTask(task.copy(isCompleted = false, dateCompletedString = null))
            updateMentoringLine()
            checkAutoSync()
        }
    }

    fun toggleParkTask(task: Task) {
        viewModelScope.launch {
            repository.updateTask(task.copy(isParked = !task.isParked))
            checkAutoSync()
        }
    }

    suspend fun suggestConcreteStep(taskTitle: String): String {
        val prompt = """
            For an ADHD user who struggles to start tasks, suggest the single smallest possible
            physical first action they can take RIGHT NOW to begin this task.
            Task: "$taskTitle"
            Reply with ONLY the action sentence, max 60 characters, no explanation, no punctuation at end.
            Example: "Open a blank doc and write the first sentence"
        """.trimIndent()
        return LociAiEngine.generate(prompt).trim().take(80).ifEmpty { "Do first tiny step" }
    }

    fun addTask(
        title: String,
        concreteStep: String,
        horizonLevel: String,
        priority: String,
        category: String,
        estimateMinutes: Int,
        deadlineTimestamp: Long? = null
    ) {
        viewModelScope.launch {
            val email = currentUserEmail.value
            val index = tasks.value.filter { it.horizonLevel == horizonLevel }.size
            val finalStep = if (concreteStep.isBlank() || concreteStep == "Do first tiny step" || concreteStep == "Check status") {
                suggestConcreteStep(title)
            } else {
                concreteStep
            }
            val fresh = Task(
                userId = email,
                title = title,
                concreteStep = finalStep,
                horizonLevel = horizonLevel,
                priority = priority,
                category = category,
                timeEstimateMinutes = estimateMinutes,
                deadlineTimestamp = deadlineTimestamp,
                orderIndex = index
            )
            repository.insertTask(fresh)
            if (isAutoSyncEnabled) {
                triggerCloudSyncAnimation()
            }
        }
    }

    fun editTask(
        id: Int,
        title: String,
        concreteStep: String,
        horizonLevel: String,
        priority: String,
        category: String,
        estimateMinutes: Int,
        deadlineTimestamp: Long? = null
    ) {
        viewModelScope.launch {
            val existing = repository.getTaskById(id) ?: return@launch
            val updated = existing.copy(
                title = title,
                concreteStep = concreteStep,
                horizonLevel = horizonLevel,
                priority = priority,
                category = category,
                timeEstimateMinutes = estimateMinutes,
                deadlineTimestamp = deadlineTimestamp
            )
            repository.updateTask(updated)
            checkAutoSync()
        }
    }

    fun deleteTask(task: Task) {
        viewModelScope.launch {
            repository.updateTask(task.copy(isDeleted = true))
            checkAutoSync()
        }
    }

    // Reorder Priorities
    fun moveTaskUp(task: Task) {
        viewModelScope.launch {
            val levelTasks = tasks.value.filter { it.horizonLevel == task.horizonLevel }.sortedBy { it.orderIndex }
            val index = levelTasks.indexOf(task)
            if (index > 0) {
                val prev = levelTasks[index - 1]
                repository.updateTask(prev.copy(orderIndex = task.orderIndex))
                repository.updateTask(task.copy(orderIndex = prev.orderIndex))
                checkAutoSync()
            }
        }
    }

    fun moveTaskDown(task: Task) {
        viewModelScope.launch {
            val levelTasks = tasks.value.filter { it.horizonLevel == task.horizonLevel }.sortedBy { it.orderIndex }
            val index = levelTasks.indexOf(task)
            if (index in 0 until levelTasks.size - 1) {
                val next = levelTasks[index + 1]
                repository.updateTask(next.copy(orderIndex = task.orderIndex))
                repository.updateTask(task.copy(orderIndex = next.orderIndex))
                checkAutoSync()
            }
        }
    }

    // Move strategic task to different horizon level (Today -> Month, Office -> Today, etc.)
    fun moveTaskToHorizonLevel(task: Task, targetLevel: String) {
        viewModelScope.launch {
            val index = tasks.value.filter { it.horizonLevel == targetLevel }.size
            repository.updateTask(task.copy(horizonLevel = targetLevel, orderIndex = index))
            checkAutoSync()
        }
    }

    // AI/Auto Inference categorization on Free form Input
    fun captureBrainDump(input: String) {
        if (input.trim().isEmpty()) return
        val clean = input.trim()

        viewModelScope.launch {
            val prompt = """
                You are an ADHD productivity assistant. Parse this brain dump text and extract tasks.
                If multiple tasks are found/implied, parse each.
                For each task found, return a JSON array with objects containing:
                - "title": short task title (max 60 chars)
                - "concreteStep": the single smallest physical first action to start (max 60 chars)
                - "category": one of Career, Health, Work, Personal
                - "priority": one of P1, P2, P3, P4 (P1=urgent, P4=low energy)
                - "estimateMinutes": realistic integer estimate (5, 10, 15, 20, 25, 30, 45, 60, 90)
                - "horizonLevel": one of today, week, month, quarter, halfyear, office (infer from phrases like "this week" -> week, "next month" -> month, "at work" -> office, "someday" -> month, default to "today")
                - "deadlineHint": a natural language date hint like "Thursday" or "end of month" (or null)
                
                Brain dump text: "$clean"
                
                Return ONLY a valid JSON array, no explanation. Example:
                [{"title":"Fix resume","concreteStep":"Open the file and read the first bullet","category":"Career","priority":"P2","estimateMinutes":30,"horizonLevel":"week","deadlineHint":"Friday"}]
            """.trimIndent()

            val response = LociAiEngine.generate(prompt)

            try {
                val jsonStart = response.indexOf('[')
                val jsonEnd = response.lastIndexOf(']') + 1
                if (jsonStart >= 0 && jsonEnd > jsonStart) {
                    val jsonStr = response.substring(jsonStart, jsonEnd)
                    val moshi = Moshi.Builder()
                        .addLast(KotlinJsonAdapterFactory()).build()
                    val adapter = moshi.adapter<List<Map<String, Any>>>(
                        Types.newParameterizedType(List::class.java, Map::class.java)
                    )
                    val tasks = adapter.fromJson(jsonStr) ?: emptyList()
                    tasks.forEach { task ->
                        addTask(
                            title = task["title"] as? String ?: clean,
                            concreteStep = task["concreteStep"] as? String ?: "Do first tiny step",
                            horizonLevel = task["horizonLevel"] as? String ?: "today",
                            priority = task["priority"] as? String ?: "P3",
                            category = task["category"] as? String ?: "Personal",
                            estimateMinutes = (task["estimateMinutes"] as? Double)?.toInt() ?: 25
                        )
                    }
                } else {
                    // fallback: add as single plain task
                    addTask(title = clean, concreteStep = "Do first tiny step",
                        horizonLevel = "today", priority = "P3", category = "Personal", estimateMinutes = 25)
                }
            } catch (e: Exception) {
                // fallback on any parse error
                addTask(title = clean, concreteStep = "Do first tiny step",
                    horizonLevel = "today", priority = "P3", category = "Personal", estimateMinutes = 25)
            }
        }
    }

    // ADHD Coach Morning Ritual sub-timers
    fun startMorningRitual() {
        activeRitualStepIndex = 0
        runRitualStepTimer()
    }

    private fun runRitualStepTimer() {
        ritualJob?.cancel()
        if (activeRitualStepIndex >= 0 && activeRitualStepIndex < ritualSteps.size) {
            ritualSecondsRemaining = ritualSteps[activeRitualStepIndex].second
            ritualJob = viewModelScope.launch {
                while (ritualSecondsRemaining > 0) {
                    delay(1000)
                    ritualSecondsRemaining--
                }
                nextRitualStep()
            }
        }
    }

    fun nextRitualStep() {
        ritualJob?.cancel()
        if (activeRitualStepIndex in 0 until ritualSteps.size - 1) {
            activeRitualStepIndex++
            runRitualStepTimer()
        } else {
            // Ritual finished completely! Add 80 XP points
            activeRitualStepIndex = -1
            addXpScore(80)
        }
    }

    fun stopMorningRitual() {
        ritualJob?.cancel()
        activeRitualStepIndex = -1
    }

    // Stuck rescue mode steps
    fun startStuckRescue() {
        rescueCurrentStepIndex = 0
        showStuckRescueDialog = true
    }

    fun nextRescueStep() {
        if (rescueCurrentStepIndex < rescueSteps.size - 1) {
            rescueCurrentStepIndex++
        } else {
            showStuckRescueDialog = false
            // Add tiny success trigger
            addXpScore(25)
        }
    }

    // Bad Day Reset - clears all tasks of active Focus state to restore stability without deleting data
    fun triggerBadDayReset() {
        viewModelScope.launch {
            pauseFocusTimer()
            tasks.value.forEach {
                if (it.isNowFocus) {
                    repository.updateTask(it.copy(isNowFocus = false))
                }
            }
            updateMentoringLine()
        }
    }

    // AI Weekly Review Action (coined for Improvement 5)
    fun runWeeklyAiReview() {
        viewModelScope.launch {
            isWeeklyReviewLoading = true
            weeklyReviewSuggestion = ""
            try {
                // Initialize generative model with modern recommended version
                val configVal = config.value
                val mentorName = configVal?.mentorName ?: "Marcus Aurelius"
                
                val model = GenerativeModel(
                    modelName = "gemini-3.5-flash",
                    apiKey = com.loci.app.BuildConfig.GEMINI_API_KEY
                )

                val allTasks = tasks.value
                val backlog = allTasks.filter { !it.isCompleted && !it.isDeleted }
                val taskListPrompt = if (backlog.isEmpty()) {
                    "None (Keep user active, ask them to write a brain dump!)"
                } else {
                    backlog.joinToString("\n") { task ->
                        "- ${task.title} (Horizon: ${task.horizonLevel}, Priority: ${task.priority}, Category: ${task.category}, Est: ${task.timeEstimateMinutes}m)"
                    }
                }

                val prompt = """
                    You are $mentorName, the user's wise focal ADHD Coach. 
                    The user has requested your AI Weekly review.
                    Here is their backlog list of uncompleted tasks:
                    $taskListPrompt
                    
                    Identify 1-3 highly tactical tasks that would be most productive to promote to "Today" based on their priority, ease of execution, or category alignment.
                    Make your recommendations encouraging, direct, short, and optimized for an ADHD brain. Focus on removing starting friction.
                """.trimIndent()

                val response = model.generateContent(prompt)
                weeklyReviewSuggestion = response.text ?: "Could not compile suggestion. Try again!"
            } catch (e: Exception) {
                android.util.Log.e("LociViewModel", "AI Weekly Review failed", e)
                weeklyReviewSuggestion = "Error running AI Review. Confirm your API Key is inserted in the Secrets panel."
            } finally {
                isWeeklyReviewLoading = false
            }
        }
    }

    // Direct chat with Mentor (coined for Improvement 6)
    fun sendChatMessage() {
        val message = chatInputText.trim()
        if (message.isEmpty()) return
        
        chatInputText = ""
        chatHistory.add(message to true)

        viewModelScope.launch {
            isChatLoading = true
            try {
                val configVal = config.value
                val mentorName = configVal?.mentorName ?: "Marcus Aurelius"
                val challenge = configVal?.challengeType ?: "starting"
                val isLowEnergy = configVal?.isLowEnergyMode ?: false
                
                val model = GenerativeModel(
                    modelName = "gemini-3.5-flash",
                    apiKey = com.loci.app.BuildConfig.GEMINI_API_KEY
                )

                // Build full context prompt
                val energyMode = if (isLowEnergy) "Low Energy Mode Activated (Prefers simple, easy, low-starting friction tasks)" else "Standard Energy Mode"
                
                val systemPrompt = """
                    You are $mentorName, the user's wise, compassionate ADHD mentor. 
                    User Profile Info:
                    - Principal ADHD challenge focus: $challenge
                    - Current physical/mental state: $energyMode
                    
                    Respond to the user's message as $mentorName. Tailor your wisdom to their ADHD situation and current state. 
                    Give ultra-short, concrete, encouraging recommendations. Always keep the response under 3 sentences to protect working memory.
                """.trimIndent()

                // Include a small window of previous messages for context
                val conversationPrompt = chatHistory.takeLast(6).joinToString("\n") { (text, isUser) ->
                    if (isUser) "User: $text" else "$mentorName: $text"
                }

                val fullPrompt = "$systemPrompt\n\nRecent Conversation History:\n$conversationPrompt\n\nProvide the next advice response as $mentorName."

                val response = model.generateContent(fullPrompt)
                val advice = response.text?.trim() ?: "Keep steady. Begin with one tiny step."
                chatHistory.add(advice to false)
            } catch (e: Exception) {
                android.util.Log.e("LociViewModel", "Chat with AI Mentor failed", e)
                chatHistory.add("Sorry, I had trouble connecting to my thoughts. Let's take a deep breath and start tiny." to false)
            } finally {
                isChatLoading = false
            }
        }
    }

    override fun onCleared() {
        timerJob?.cancel()
        ritualJob?.cancel()
        super.onCleared()
    }
}

// Factory
class LociViewModelFactory(
    private val repository: LociRepository,
    private val application: Application
) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        if (modelClass.isAssignableFrom(LociViewModel::class.java)) {
            @Suppress("UNCHECKED_CAST")
            return LociViewModel(repository, application) as T
        }
        throw IllegalArgumentException("Unknown ViewModel class")
    }
}
