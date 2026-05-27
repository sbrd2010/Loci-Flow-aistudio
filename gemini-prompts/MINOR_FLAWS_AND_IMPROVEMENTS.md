# Loci App — Minor Flaws Fix + AI Feature Improvements

You are working on the Loci Android ADHD productivity app built with Kotlin, Jetpack Compose,
MVVM architecture, Room database, and Firebase Realtime Database sync.

The full codebase is attached. Implement all fixes and improvements below in order.
Do not change any logic unrelated to a specific fix.
After completing everything, list every file modified or created.

---

# PART 1 — Minor Flaws (10 fixes)

---

## MINOR FIX 1 — Update the app namespace and package name

In `app/build.gradle.kts`:
- Change `namespace = "com.example"` to `namespace = "com.loci.app"`
- Change `applicationId = "com.aistudio.pwatoandroid.cxhsyq"` to `applicationId = "com.loci.app"`

In every `.kt` source file under `app/src/main/java/com/example/`, update the package declaration
from `package com.example` (or `package com.example.ui`, `package com.example.data`) to
`package com.loci.app`, `package com.loci.app.ui`, and `package com.loci.app.data` respectively.

Move (rename) the directory structure from `com/example/` to `com/loci/app/` to match.

Update all import statements across all files accordingly.

---

## MINOR FIX 2 — Replace the fake "9:41" clock in the top status bar with real time

In `LociScreen.kt` (in the `topBar` section), there is a hardcoded `Text(text = "9:41")`.
Replace it with a composable that shows the real current time, updating every minute:

```kotlin
var currentTime by remember { mutableStateOf("") }

fun formatNow(): String {
    val cal = Calendar.getInstance()
    val hour = cal.get(Calendar.HOUR_OF_DAY)
    val minute = cal.get(Calendar.MINUTE)
    val displayHour = if (hour % 12 == 0) 12 else hour % 12
    val amPm = if (hour >= 12) "PM" else "AM"
    return "$displayHour:${String.format("%02d", minute)} $amPm"
}

LaunchedEffect(Unit) {
    while (true) {
        currentTime = formatNow()
        delay(60_000L)
    }
}

Text(
    text = currentTime,
    fontSize = 12.sp,
    fontWeight = FontWeight.Medium,
    color = NaturalText
)
```

---

## MINOR FIX 3 — Fix the pause button icon (shows Lock icon instead of Pause)

In `ActiveFocusNowCard` composable (in `TodayTab.kt` after the file split, or `LociScreen.kt`),
find this line:
```kotlin
imageVector = if (viewModel.isTimerRunning) Icons.Default.Lock else Icons.Default.PlayArrow,
```
Change `Icons.Default.Lock` to `Icons.Default.Pause`:
```kotlin
imageVector = if (viewModel.isTimerRunning) Icons.Default.Pause else Icons.Default.PlayArrow,
```

---

## MINOR FIX 4 — Remove fabricated "connected devices" and fake port numbers from SyncHubDialog

In `SyncHubDialog` (in `Dialogs.kt` after the file split, or `LociScreen.kt`), remove the entire
"Connected Screen Devices" section that shows:
- "Mobile Client (Active Android Phone) — This Handheld Instance • Port 6710 • Online Now"
- "Tablet Client (Large Screen Display) — Dual Screen Instance • Connected, Synced 1m ago"

Replace it with a simple honest status card:
```
Sync Status: This device syncs with Firebase when you complete or add tasks.
All your data is stored locally and backed up to the cloud automatically.
```
Display it as a plain `Text` composable with `NaturalMuted` color inside a small Card.
Also remove the "Text: Connected Screen Devices:" label above it.

---

## MINOR FIX 5 — Enable minification in release builds

In `app/build.gradle.kts`, inside the `release` build type block, change:
```kotlin
isMinifyEnabled = false
```
to:
```kotlin
isMinifyEnabled = true
```

Also ensure the proguard rules file is correctly referenced (it already is in the existing config,
so no change needed there).

---

## MINOR FIX 6 — Remove the unused ViewModel brainDumpText state

In `LociViewModel.kt`, there is a state variable `var brainDumpText by mutableStateOf("")`
that is never used by any UI composable (the `BrainDumpQuickCapture` composable uses its own
local `text` state instead).

Remove the `var brainDumpText by mutableStateOf("")` line from `LociViewModel.kt`.
Also remove the line `brainDumpText = ""` inside `captureBrainDump()` if it exists.
The local state in `BrainDumpQuickCapture` already handles the clear correctly.

---

## MINOR FIX 7 — Add input validation so empty task titles cannot be submitted

In `LociScreen.kt` (in the `AddTaskDialog` composable or its `onConfirm` lambda),
add a guard so the task is only added if the title is not blank:

In the `onConfirm` callback:
```kotlin
onConfirm = {
    if (newTaskTitle.isNotBlank()) {
        val minutesNum = newTaskDuration.toIntOrNull() ?: 25
        viewModel.addTask(
            title = newTaskTitle.trim(),
            concreteStep = newTaskStep.trim(),
            horizonLevel = newTaskLevel,
            priority = newTaskPriority,
            category = newTaskCategory,
            estimateMinutes = minutesNum
        )
        showAddTaskDialog = false
    }
}
```

Also inside `AddTaskDialog`, disable the confirm button when the title field is blank:
```kotlin
enabled = title.isNotBlank()
```

---

## MINOR FIX 8 — Enable Room schema export for migration safety

In `Database.kt`, change:
```kotlin
@Database(entities = [...], version = X, exportSchema = false)
```
to:
```kotlin
@Database(entities = [...], version = X, exportSchema = true)
```

In `app/build.gradle.kts`, inside the `android { }` block, add the schema export directory
so Room knows where to write the schema files:
```kotlin
ksp {
    arg("room.schemaLocation", "$projectDir/schemas")
}
```

---

## MINOR FIX 9 — Fix the bento contribution grid date calculation

In `ADHDContributionBentoWidget` (in `BentoGrid.kt` after split, or `LociScreen.kt`),
the current date calculation for `computedDaysAgo` uses:
```kotlin
val computedDaysAgo = (14 - col) * 7 + (6 - row)
```
This miscalculates dates. Replace it with a correct calculation that maps a 15-column,
7-row grid where column 14 row 6 = today, column 14 row 0 = 6 days ago, column 13 = 7-13 days ago etc:

```kotlin
val computedDaysAgo = (14 - col) * 7 + (6 - row)
```
This formula is actually correct in intent (most recent = col 14, row 6 = today).
However the issue is the grid currently shows the columns left-to-right as oldest-to-newest.
Verify that `col=14, row=6` correctly maps to `daysAgo=0` (today). If it does, add a
date tooltip-style `contentDescription` to each box so accessibility tools can read the date:
```kotlin
.semantics { contentDescription = "$dateStr: $matchingCount tasks" }
```

Also increase the grid size from 14 columns to 16 columns (showing ~16 weeks) for a richer history view.

---

## MINOR FIX 10 — Add label to animateColorAsState to fix Compose inspection warning

In `BottomNav.kt` (or `LociScreen.kt`), inside `NavigationBarItemCustom`, find:
```kotlin
val animatedPillColor by animateColorAsState(
    targetValue = if (isSelected) NaturalAccent else Color.Transparent
)
```
Add a `label` parameter:
```kotlin
val animatedPillColor by animateColorAsState(
    targetValue = if (isSelected) NaturalAccent else Color.Transparent,
    label = "navPillColor"
)
```

---

# PART 2 — Genuine AI-Powered Improvements (5 features using Gemini API)

**Before starting Part 2**, add the Google Generative AI SDK dependency:

In `app/build.gradle.kts`:
```kotlin
implementation("com.google.ai.client.generativeai:generativeai:0.9.0")
```

The Gemini API key will be stored in the `.env` file as `GEMINI_API_KEY=your_key_here`
and accessed as `BuildConfig.GEMINI_API_KEY`. The project already uses the Secrets Gradle Plugin
for `.env` file support, so no plugin changes are needed.

Create a new file `app/src/main/java/com/example/data/LociAiEngine.kt`:
```kotlin
package com.example.data

import com.google.ai.client.generativeai.GenerativeModel

object LociAiEngine {
    private val model by lazy {
        GenerativeModel(
            modelName = "gemini-1.5-flash",
            apiKey = com.example.BuildConfig.GEMINI_API_KEY ?: ""
        )
    }

    suspend fun generate(prompt: String): String {
        return try {
            model.generateContent(prompt).text ?: ""
        } catch (e: Exception) {
            ""
        }
    }
}
```

---

## IMPROVEMENT 1 — Real Gemini AI for Brain Dump parsing

Currently `captureBrainDump()` in `LociViewModel.kt` uses simple keyword matching.
Replace it with a real Gemini API call.

In `LociViewModel.kt`, rewrite `captureBrainDump()` as a suspend-based function:

```kotlin
fun captureBrainDump(input: String) {
    if (input.trim().isEmpty()) return
    val clean = input.trim()
    val email = currentUserEmail.value

    viewModelScope.launch {
        val prompt = """
            You are an ADHD productivity assistant. Parse this brain dump text and extract tasks.
            For each task found, return a JSON array with objects containing:
            - "title": short task title (max 60 chars)
            - "concreteStep": the single smallest physical first action to start (max 60 chars)
            - "category": one of Career, Health, Work, Personal
            - "priority": one of P1, P2, P3, P4 (P1=urgent, P4=low energy)
            - "estimateMinutes": realistic integer estimate (5, 10, 15, 20, 25, 30, 45, 60, 90)
            
            Brain dump text: "$clean"
            
            Return ONLY a valid JSON array, no explanation. Example:
            [{"title":"Fix resume","concreteStep":"Open the file and read the first bullet","category":"Career","priority":"P2","estimateMinutes":30}]
        """.trimIndent()

        val response = LociAiEngine.generate(prompt)

        try {
            val jsonStart = response.indexOf('[')
            val jsonEnd = response.lastIndexOf(']') + 1
            if (jsonStart >= 0 && jsonEnd > jsonStart) {
                val jsonStr = response.substring(jsonStart, jsonEnd)
                val moshi = com.squareup.moshi.Moshi.Builder()
                    .addLast(com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory()).build()
                val adapter = moshi.adapter<List<Map<String, Any>>>(
                    com.squareup.moshi.Types.newParameterizedType(List::class.java, Map::class.java)
                )
                val tasks = adapter.fromJson(jsonStr) ?: emptyList()
                tasks.forEach { task ->
                    addTask(
                        title = task["title"] as? String ?: clean,
                        concreteStep = task["concreteStep"] as? String ?: "Do first tiny step",
                        horizonLevel = "today",
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
```

---

## IMPROVEMENT 2 — AI-generated concrete first step when adding a task

When a user adds a new task via the `AddTaskDialog` and leaves the `concreteStep` field blank,
automatically call Gemini to generate a concrete first step.

In `LociViewModel.kt`, add a new function:
```kotlin
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
```

In `addTask()` in `LociViewModel.kt`, if `concreteStep` is blank or "Do first tiny step", call:
```kotlin
val finalStep = if (concreteStep.isBlank() || concreteStep == "Do first tiny step") {
    suggestConcreteStep(title)
} else {
    concreteStep
}
```
Use `finalStep` instead of `concreteStep` when creating the `Task` object.

---

## IMPROVEMENT 3 — AI-powered personalized mentor coaching messages

Currently `updateMentoringLine()` returns hardcoded strings. Replace it with a Gemini-powered
contextual message that changes based on real user state.

In `LociViewModel.kt`, rewrite `updateMentoringLine()`:

```kotlin
fun updateMentoringLine() {
    val cur = config.value ?: return
    val itemsDone = tasks.value.count { it.horizonLevel == "today" && it.isCompleted }
    val totalToday = tasks.value.count { it.horizonLevel == "today" }
    val activeTaskTitle = tasks.value.firstOrNull { it.isNowFocus }?.title ?: "no active task"
    val timeOfDay = when (Calendar.getInstance().get(Calendar.HOUR_OF_DAY)) {
        in 5..11 -> "morning"
        in 12..17 -> "afternoon"
        in 18..21 -> "evening"
        else -> "late night"
    }

    viewModelScope.launch {
        val prompt = """
            You are ${cur.mentorName}, speaking directly to ${cur.userName} who has ADHD.
            Give a single motivating sentence (max 100 chars) appropriate for this situation:
            - Time of day: $timeOfDay
            - Tasks completed today: $itemsDone out of $totalToday
            - Current focus task: $activeTaskTitle
            - Their main challenge: ${cur.challengeType}
            - Energy mode: ${if (cur.isLowEnergyMode) "low energy" else "standard"}
            
            Speak IN CHARACTER as ${cur.mentorName}. Be brief, warm, specific to their situation.
            Do NOT use quotation marks. Reply with ONLY the sentence.
        """.trimIndent()

        val response = LociAiEngine.generate(prompt)
        if (response.isNotEmpty()) {
            mentoringQuote = "\"$response\" — ${cur.mentorName}"
        } else {
            // fallback to simple static quote
            mentoringQuote = "\"Start tiny. One action. Right now.\" — ${cur.mentorName}"
        }
    }
}
```

---

## IMPROVEMENT 4 — Natural language task input in Brain Dump

Enhance the `BrainDumpQuickCapture` placeholder text and send a richer context prompt
so Gemini understands natural language scheduling cues.

In `LociAiEngine.kt` (or `LociViewModel.kt`), update the Brain Dump prompt from Improvement 1
to also parse natural language time references:

Add to the JSON object schema:
- `"horizonLevel"`: one of `today`, `week`, `month`, `quarter`, `halfyear`, `office`
  (infer from phrases like "this week", "next month", "at work", "someday", default to "today")
- `"deadlineHint"`: a natural language date hint like "Thursday" or "end of month" (or null)

Update the `addTask()` calls to use the parsed `horizonLevel` instead of hardcoding `"today"`.

Update the placeholder text in `BrainDumpQuickCapture` to:
`"Dump anything — 'call dentist thursday', 'fix cv this week', 'gym today'..."`

---

## IMPROVEMENT 5 — Weekly review: AI-suggested tasks to promote to Today

Add a new button in the `LociCoachTabContent` called **"AI Weekly Review"**.

When tapped, it calls Gemini with the user's current task list across all horizon levels
and asks for suggestions on which non-today tasks to promote to Today based on urgency,
deadline proximity, and the user's current XP/energy pattern.

In `LociViewModel.kt`, add:
```kotlin
var weeklyReviewSuggestion by mutableStateOf("")
var isWeeklyReviewLoading by mutableStateOf(false)

fun runWeeklyAiReview() {
    val cur = config.value ?: return
    isWeeklyReviewLoading = true
    viewModelScope.launch {
        val taskSummary = tasks.value
            .filter { !it.isCompleted && it.horizonLevel != "today" }
            .take(20)
            .joinToString("\n") { "- [${it.horizonLevel}][${it.priority}] ${it.title}" }

        val prompt = """
            You are an ADHD productivity coach reviewing ${cur.userName}'s task backlog.
            Based on these non-today tasks, suggest 2-3 specific tasks they should pull into 
            Today's list RIGHT NOW, and briefly explain why each one is timely.
            Keep the entire response under 120 words. Be direct and energising.
            
            Backlog:
            $taskSummary
        """.trimIndent()

        val response = LociAiEngine.generate(prompt)
        weeklyReviewSuggestion = response.ifEmpty { "No suggestions available. Your backlog looks clear!" }
        isWeeklyReviewLoading = false
    }
}
```

In `LociCoachTabContent` (or `CoachTab.kt`), add a new Card after the "Stuck Rescue" card:
- Title: "AI Weekly Horizon Review"
- Description: "Let your AI mentor scan your backlog and tell you what to pull into today."
- Button: "Run AI Review" → calls `viewModel.runWeeklyAiReview()`
- Show a `CircularProgressIndicator` while `isWeeklyReviewLoading` is true
- Show `weeklyReviewSuggestion` text in a styled box when it's not empty

---

After completing all fixes and improvements, output a complete list of every file modified and
every new file created. Also add a note reminding the user to add their Gemini API key to the
`.env` file as `GEMINI_API_KEY=their_key_here` and get one free from `ai.google.dev`.
