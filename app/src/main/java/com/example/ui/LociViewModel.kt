package com.example.ui

import android.content.Context
import androidx.compose.runtime.*
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.example.data.*
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
    private val context: Context
) : ViewModel() {

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

    // Brain dump temporary input
    var brainDumpText by mutableStateOf("")

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
        // Run periodic updates
        viewModelScope.launch {
            while (true) {
                updateDayTimelineProgress()
                delay(60000) // update every minute
            }
        }

        // Initialize default pre-seeded accounts for Amos (husband) and Sarah (wife)
        viewModelScope.launch {
            // Seed the primary husband account
            seedUser("husband@gmail.com", "Amos", "Marcus Aurelius")
            // Seed the secondary wife account
            seedUser("wife@gmail.com", "Sarah", "Yoda")

            // Wait a moment for seeding transactions to settle, then load initial config details
            delay(200)
            val existing = repository.getConfigForUser(currentUserEmail.value).firstOrNull()
            if (existing != null) {
                timerSecondsLeft = existing.pomodoroDurationMinutes * 60
                timerMaxSeconds = existing.pomodoroDurationMinutes * 60
            } else {
                showOnboarding = true
            }
            updateMentoringLine()
        }
    }

    // Seeding logic to populate offline database workspace profiles
    fun seedUser(email: String, name: String, mentor: String) {
        viewModelScope.launch {
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
        }
    }

    // Account switching utility
    fun selectUserAccount(email: String) {
        viewModelScope.launch {
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
                    timerSecondsLeft = freshlySeeded.pomodoroDurationMinutes * 60
                    timerMaxSeconds = freshlySeeded.pomodoroDurationMinutes * 60
                }
            } else {
                timerSecondsLeft = existing.pomodoroDurationMinutes * 60
                timerMaxSeconds = existing.pomodoroDurationMinutes * 60
            }
            updateMentoringLine()
            triggerCloudSyncAnimation()
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

        mentoringQuote = when (cur.challengeType) {
            "starting" -> if (itemsDone == 0) {
                "\"Starting sits in your prefrontal cortex. Don't plan. Just draft 5 words.\" — $name"
            } else {
                "\"You broke the inertia! One tiny step leads to clarity.\" — $name"
            }
            "focusing" -> "\"Quiet focus is a muscle, Amos. Protect this 25-minute space.\" — $name"
            "execution" -> "\"A complete micro-step is better than a perfect layout design.\" — $name"
            else -> "\"Reviewing your day capacity builds true temporal awareness.\" — $name"
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
            val fresh = Task(
                userId = email,
                title = title,
                concreteStep = concreteStep.ifEmpty { "Do first tiny step" },
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
            repository.deleteTask(task)
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

        // Inference logic based on task context matching
        val inferredCategory = when {
            clean.contains("resume", ignoreCase = true) || clean.contains("cv", ignoreCase = true) ||
                    clean.contains("job", ignoreCase = true) || clean.contains("apply", ignoreCase = true) ||
                    clean.contains("interview", ignoreCase = true) || clean.contains("hire", ignoreCase = true) -> "Career"

            clean.contains("gym", ignoreCase = true) || clean.contains("walk", ignoreCase = true) ||
                    clean.contains("stretch", ignoreCase = true) || clean.contains("sleep", ignoreCase = true) ||
                    clean.contains("run", ignoreCase = true) || clean.contains("water", ignoreCase = true) ||
                    clean.contains("doctor", ignoreCase = true) -> "Health"

            clean.contains("report", ignoreCase = true) || clean.contains("code", ignoreCase = true) ||
                    clean.contains("meeting", ignoreCase = true) || clean.contains("email", ignoreCase = true) ||
                    clean.contains("client", ignoreCase = true) -> "Work"

            else -> "Personal"
        }

        addTask(
            title = clean,
            concreteStep = "Check status",
            horizonLevel = "today",
            priority = "P3",
            category = inferredCategory,
            estimateMinutes = 25
        )
        brainDumpText = ""
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

    override fun onCleared() {
        timerJob?.cancel()
        ritualJob?.cancel()
        super.onCleared()
    }
}

// Factory
class LociViewModelFactory(
    private val repository: LociRepository,
    private val context: Context
) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        if (modelClass.isAssignableFrom(LociViewModel::class.java)) {
            @Suppress("UNCHECKED_CAST")
            return LociViewModel(repository, context) as T
        }
        throw IllegalArgumentException("Unknown ViewModel class")
    }
}
