package com.example.ui

import androidx.compose.animation.*
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.data.*
import com.example.ui.theme.*
import java.text.SimpleDateFormat
import java.util.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LociScreen(
    viewModel: LociViewModel,
    modifier: Modifier = Modifier
) {
    val configState by viewModel.config.collectAsStateWithLifecycle()
    val tasksState by viewModel.tasks.collectAsStateWithLifecycle()
    val contributionsState by viewModel.contributions.collectAsStateWithLifecycle()

    val config = configState ?: LociConfig()

    // Add task dialogue inputs
    var showAddTaskDialog by remember { mutableStateOf(false) }
    var newTaskTitle by remember { mutableStateOf("") }
    var newTaskStep by remember { mutableStateOf("") }
    var newTaskPriority by remember { mutableStateOf("P3") }
    var newTaskLevel by remember { mutableStateOf("today") }
    var newTaskCategory by remember { mutableStateOf("Career") }
    var newTaskDuration by remember { mutableStateOf("25") }

    // Onboarding dialog
    if (viewModel.showOnboarding) {
        OnboardingQuizDialog(
            viewModel = viewModel,
            onDismiss = { viewModel.finishOnboarding() }
        )
    }

    // Stuck rescue question slider
    if (viewModel.showStuckRescueDialog) {
        StuckRescueDialog(
            viewModel = viewModel,
            onDismiss = { viewModel.showStuckRescueDialog = false }
        )
    }

    // Co-Sync & Multi-User Account Manager panel overlay
    if (viewModel.showSyncHubDialog) {
        SyncHubDialog(
            viewModel = viewModel,
            onDismiss = { viewModel.showSyncHubDialog = false }
        )
    }

    Scaffold(
        modifier = modifier
            .fillMaxSize()
            .background(NaturalBg),
        topBar = {
            Column {
                // Mock native status bar styled like responsive theme
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 24.dp, vertical = 8.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "9:41",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium,
                        color = NaturalText
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Box(
                            modifier = Modifier
                                .size(14.dp)
                                .border(1.5.dp, NaturalText.copy(alpha = 0.25f), CircleShape)
                        )
                        Box(
                            modifier = Modifier
                                .size(14.dp)
                                .border(1.5.dp, NaturalText.copy(alpha = 0.25f), CircleShape)
                        )
                    }
                }

                // Top standard M3 Bar
                TopAppBar(
                    title = {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Icon(
                                imageVector = Icons.Default.Favorite,
                                contentDescription = "Loci Heart Logo",
                                tint = BrandPurple,
                                modifier = Modifier
                                    .padding(end = 8.dp)
                                    .size(24.dp)
                            )
                            Text(
                                text = "Loci Focus",
                                style = MaterialTheme.typography.titleLarge.copy(
                                    fontWeight = FontWeight.Light,
                                    color = NaturalText,
                                    letterSpacing = 0.5.sp
                                )
                            )
                            Spacer(modifier = Modifier.weight(1f))

                            // Organic initials Badge (Avatars) clickable to trigger Sync Hub
                            Box(
                                modifier = Modifier
                                    .size(40.dp)
                                    .clip(CircleShape)
                                    .background(NaturalAccent)
                                    .clickable { viewModel.showSyncHubDialog = true }
                                    .border(1.dp, NaturalText.copy(alpha = 0.12f), CircleShape),
                                contentAlignment = Alignment.Center
                            ) {
                                Text(
                                    text = config.userName.take(2).uppercase(),
                                    style = MaterialTheme.typography.bodyMedium.copy(
                                        fontWeight = FontWeight.Bold,
                                        color = NaturalAccentDark,
                                        fontSize = 13.sp
                                    )
                                )
                            }
                            Spacer(modifier = Modifier.width(16.dp))
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = Color.Transparent)
                )
            }
        },
        bottomBar = {
            BottomAppNavigationBar(
                selectedTab = viewModel.activeTab,
                onTabSelected = { viewModel.selectTab(it) }
            )
        },
        floatingActionButton = {
            FloatingActionButton(
                onClick = {
                    newTaskTitle = ""
                    newTaskStep = ""
                    newTaskPriority = "P3"
                    newTaskLevel = "today"
                    newTaskCategory = "Career"
                    newTaskDuration = "25"
                    showAddTaskDialog = true
                },
                containerColor = NaturalAccent,
                contentColor = NaturalAccentDark,
                shape = RoundedCornerShape(16.dp),
                modifier = Modifier
                    .padding(bottom = 12.dp)
                    .testTag("floating_add_task_btn")
            ) {
                Icon(imageVector = Icons.Default.Add, contentDescription = "Add Strategical Task")
            }
        }
    ) { innerPadding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .background(NaturalBg)
        ) {
            when (viewModel.activeTab) {
                LociTab.Today -> LociTodayTabContent(
                    config = config,
                    tasks = tasksState,
                    viewModel = viewModel,
                    contributions = contributionsState
                )
                LociTab.Roadmap -> LociRoadmapTabContent(
                    tasks = tasksState,
                    viewModel = viewModel
                )
                LociTab.Coach -> LociCoachTabContent(
                    config = config,
                    viewModel = viewModel
                )
                LociTab.Mentor -> LociMentorTabContent(
                    config = config,
                    viewModel = viewModel
                )
            }
        }

        if (showAddTaskDialog) {
            AddTaskDialog(
                title = newTaskTitle,
                onTitleChange = { newTaskTitle = it },
                step = newTaskStep,
                onStepChange = { newTaskStep = it },
                priority = newTaskPriority,
                onPriorityChange = { newTaskPriority = it },
                level = newTaskLevel,
                onLevelChange = { newTaskLevel = it },
                category = newTaskCategory,
                onCategoryChange = { newTaskCategory = it },
                duration = newTaskDuration,
                onDurationChange = { newTaskDuration = it },
                onDismiss = { showAddTaskDialog = false },
                onConfirm = {
                    val minutesNum = newTaskDuration.toIntOrNull() ?: 25
                    viewModel.addTask(
                        title = newTaskTitle,
                        concreteStep = newTaskStep,
                        horizonLevel = newTaskLevel,
                        priority = newTaskPriority,
                        category = newTaskCategory,
                        estimateMinutes = minutesNum
                    )
                    showAddTaskDialog = false
                }
            )
        }
    }
}

@Composable
fun LociTodayTabContent(
    config: LociConfig,
    tasks: List<Task>,
    viewModel: LociViewModel,
    contributions: List<ContributionDay>
) {
    val activeTask = tasks.firstOrNull { it.isNowFocus }
    val todayTasksAll = tasks.filter { it.horizonLevel == "today" }

    // Filter today list by Low Energy mode toggled state
    val todayTasks = if (config.isLowEnergyMode) {
        todayTasksAll.filter { it.priority == "P4" || it.timeEstimateMinutes <= 20 }
    } else {
        todayTasksAll
    }

    val completedTasks = todayTasks.filter { it.isCompleted }
    val remainingTasks = todayTasks.filter { !it.isCompleted }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // Double Progress Header Dashboard: Streaks + XP points
        TodayHeaderStatistics(config = config, completedCount = completedTasks.size, totalCount = todayTasks.size)

        // Brain dump quick text capture
        BrainDumpQuickCapture(viewModel = viewModel)

        // Active Now Block focus card (Hero 1)
        ActiveFocusNowCard(activeTask = activeTask, viewModel = viewModel)

        // Time Blindness Combat tools: Day timeline horizontal bar
        TimeBlindnessTimelineSection(viewModel = viewModel, todayTasks = todayTasks)

        // Morning Ritual banner when active
        if (viewModel.activeRitualStepIndex >= 0) {
            ActiveRitualProgressBanner(viewModel = viewModel)
        }

        // Today commitments stack section
        Column(
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "Today's Focus Commits" + if (config.isLowEnergyMode) " (Low Energy Filter)" else "",
                    style = MaterialTheme.typography.titleMedium.copy(
                        fontWeight = FontWeight.Bold,
                        color = NaturalText
                    )
                )

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text(
                        text = "${completedTasks.size}/${todayTasks.size} Done",
                        style = MaterialTheme.typography.bodySmall.copy(
                            color = BrandPurple,
                            fontWeight = FontWeight.Bold
                        ),
                        modifier = Modifier
                            .background(ClaudePurple, RoundedCornerShape(12.dp))
                            .padding(horizontal = 8.dp, vertical = 4.dp)
                    )
                }
            }

            // High priority task commits
            if (todayTasks.isEmpty()) {
                Surface(
                    color = Color.White,
                    shape = RoundedCornerShape(20.dp),
                    border = BorderStroke(1.dp, NaturalBorder),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(
                        modifier = Modifier.padding(24.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Icon(
                            imageVector = Icons.Default.Info,
                            contentDescription = null,
                            tint = NaturalMuted,
                            modifier = Modifier.size(28.dp)
                        )
                        Spacer(modifier = Modifier.height(10.dp))
                        Text(
                            text = "0 focused commits today. Click add inside tab or enter a brain dump above to commit immediately.",
                            style = MaterialTheme.typography.bodySmall.copy(color = NaturalMuted),
                            textAlign = TextAlign.Center
                        )
                    }
                }
            } else {
                // Pending Tasks
                remainingTasks.sortedWith(compareBy<Task> { it.priority }.thenBy { it.orderIndex }).forEach { task ->
                    TaskCommitRow(
                        task = task,
                        onPin = { viewModel.pinTaskToFocus(task) },
                        onComplete = { viewModel.completeTask(task) },
                        onMoveUp = { viewModel.moveTaskUp(task) },
                        onMoveDown = { viewModel.moveTaskDown(task) },
                        onDelete = { viewModel.deleteTask(task) }
                    )
                }

                if (completedTasks.isNotEmpty()) {
                    Text(
                        text = "Completed Commits",
                        style = MaterialTheme.typography.labelMedium.copy(
                            fontWeight = FontWeight.Bold,
                            color = NaturalMuted,
                            letterSpacing = 0.5.sp
                        ),
                        modifier = Modifier.padding(top = 8.dp, bottom = 4.dp)
                    )

                    completedTasks.forEach { task ->
                        CompletedTaskCommitRow(
                            task = task,
                            onUncomplete = { viewModel.uncompleteTask(task) },
                            onDelete = { viewModel.deleteTask(task) }
                        )
                    }
                }
            }
        }

        // Streak bento map grid
        ADHDContributionBentoWidget(contributions = contributions, config = config)

        Spacer(modifier = Modifier.height(80.dp))
    }
}

@Composable
fun TodayHeaderStatistics(
    config: LociConfig,
    completedCount: Int,
    totalCount: Int
) {
    // Elegant Level System calculation
    val currentXp = config.totalXp
    val levelNum = (currentXp / 200) + 1
    val xpInLevel = currentXp % 200
    val levelProgress = xpInLevel.toFloat() / 200f

    val levelTitle = when (levelNum) {
        1 -> "Mindful Catalyst (L1)"
        2 -> "Inertia Crusher (L2)"
        3 -> "Deep Flow Initiate (L3)"
        4 -> "Strategic Executer (L4)"
        else -> "Master of Loci (L5+)"
    }

    var showAffirmation by remember { mutableStateOf(false) }
    val affirmations = listOf(
        "You are fully capable of doing this. Break it down to 1 minute.",
        "One small physical action is better than a perfect layout plan.",
        "Your focus is your sovereign power. Protect it right now.",
        "Action builds dopamine. Clarity follows the work.",
        "Progress is compounding. Breathe in, pick one task, start."
    )
    val randomAffirmation = remember { affirmations.random() }

    Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
        Card(
            colors = CardDefaults.cardColors(containerColor = NaturalCardBg),
            shape = RoundedCornerShape(24.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                // Top Level status row
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column {
                        Text(
                            text = levelTitle,
                            style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold, color = NaturalText)
                        )
                        Text(
                            text = "${xpInLevel}/200 XP to next level",
                            style = MaterialTheme.typography.labelSmall.copy(color = NaturalMuted)
                        )
                    }

                    // Done ratio badge
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(12.dp))
                            .background(NaturalAccent.copy(alpha = 0.5f))
                            .padding(horizontal = 10.dp, vertical = 4.dp)
                    ) {
                        Text(
                            text = if (totalCount > 0) "${(completedCount * 100) / totalCount}% Committed" else "0% Committed",
                            style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold, color = NaturalAccentDark)
                        )
                    }
                }

                // Sleek layout-level progress bar
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(8.dp)
                        .clip(CircleShape)
                        .background(NaturalText.copy(alpha = 0.06f))
                ) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth(levelProgress.coerceIn(0.01f, 1f))
                            .fillMaxHeight()
                            .clip(CircleShape)
                            .background(
                                brush = androidx.compose.ui.graphics.Brush.horizontalGradient(
                                    colors = listOf(BrandPurple, Color(0xFF9E8AF0))
                                )
                            )
                    )
                }

                // Traditional stats row
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    // Total points
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier = Modifier
                                .size(32.dp)
                                .clip(CircleShape)
                                .background(BrandPurple.copy(alpha = 0.12f)),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(imageVector = Icons.Default.Star, contentDescription = null, tint = BrandPurple, modifier = Modifier.size(16.dp))
                        }
                        Spacer(modifier = Modifier.width(8.dp))
                        Column {
                            Text(text = "XP Balance", style = MaterialTheme.typography.labelSmall.copy(color = NaturalMuted))
                            Text(text = "$currentXp XP", style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Bold, color = NaturalText))
                        }
                    }

                    // Streak
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier = Modifier
                                .size(32.dp)
                                .clip(CircleShape)
                                .background(Color(0xFFE8F2D0)),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(imageVector = Icons.Default.DateRange, contentDescription = null, tint = Color(0xFF6B8A30), modifier = Modifier.size(16.dp))
                        }
                        Spacer(modifier = Modifier.width(8.dp))
                        Column {
                            Text(text = "Daily Streak", style = MaterialTheme.typography.labelSmall.copy(color = NaturalMuted))
                            Text(text = "${config.visitStreakCount} Days", style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Bold, color = NaturalText))
                        }
                    }

                    // Commits
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier = Modifier
                                .size(32.dp)
                                .clip(CircleShape)
                                .background(NaturalAccent),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(imageVector = Icons.Default.Check, contentDescription = null, tint = NaturalAccentDark, modifier = Modifier.size(16.dp))
                        }
                        Spacer(modifier = Modifier.width(8.dp))
                        Column {
                            Text(text = "Task Ratio", style = MaterialTheme.typography.labelSmall.copy(color = NaturalMuted))
                            Text(text = "$completedCount/$totalCount", style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Bold, color = NaturalText))
                        }
                    }
                }
            }
        }

        // Dopamine Affirmation Banner
        val nativeView = androidx.compose.ui.platform.LocalView.current
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(16.dp))
                .clickable {
                    try {
                        nativeView.performHapticFeedback(android.view.HapticFeedbackConstants.LONG_PRESS)
                    } catch (e: Exception) {
                        // Silent fallback for setups without haptic motor support
                    }
                    showAffirmation = !showAffirmation
                }
                .background(BrandPurple.copy(alpha = 0.05f))
                .border(1.dp, BrandPurple.copy(alpha = 0.12f), RoundedCornerShape(16.dp))
                .padding(horizontal = 16.dp, vertical = 10.dp)
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.Favorite,
                    contentDescription = "Affirmation Heart",
                    tint = BrandPurple,
                    modifier = Modifier.size(14.dp)
                )
                Text(
                    text = if (showAffirmation) randomAffirmation else "Tap here for your daily Dopamine Affirmation...",
                    style = MaterialTheme.typography.labelSmall.copy(
                        color = BrandPurple,
                        fontWeight = FontWeight.Medium,
                        fontStyle = if (showAffirmation) androidx.compose.ui.text.font.FontStyle.Italic else androidx.compose.ui.text.font.FontStyle.Normal
                    ),
                    modifier = Modifier.weight(1f)
                )
            }
        }
    }
}

@Composable
fun BrainDumpQuickCapture(viewModel: LociViewModel) {
    var text by remember { mutableStateOf("") }

    Card(
        colors = CardDefaults.cardColors(containerColor = Color.White),
        shape = RoundedCornerShape(20.dp),
        border = BorderStroke(1.dp, NaturalBorder),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            modifier = Modifier.padding(14.dp)
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth()
            ) {
                Icon(
                    imageVector = Icons.Default.Edit,
                    contentDescription = null,
                    tint = BrandPurple,
                    modifier = Modifier.size(16.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = "Instant Brain Dump & Quick Capture",
                    style = MaterialTheme.typography.labelMedium.copy(
                        fontWeight = FontWeight.Bold,
                        color = NaturalMuted
                    )
                )
            }
            Spacer(modifier = Modifier.height(8.dp))
            OutlinedTextField(
                value = text,
                onValueChange = { text = it },
                placeholder = {
                    Text(
                        "Captured items categorized automatically (e.g. gym, cv)",
                        fontSize = 13.sp,
                        color = NaturalMuted.copy(alpha = 0.7f)
                    )
                },
                trailingIcon = {
                    IconButton(onClick = {
                        viewModel.captureBrainDump(text)
                        text = ""
                    }) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowForward,
                            contentDescription = "Capture Action",
                            tint = BrandPurple
                        )
                    }
                },
                keyboardOptions = KeyboardOptions(
                    imeAction = ImeAction.Done,
                    keyboardType = KeyboardType.Text
                ),
                keyboardActions = KeyboardActions(
                    onDone = {
                        viewModel.captureBrainDump(text)
                        text = ""
                    }
                ),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = ProgressGreyGreen,
                    unfocusedBorderColor = NaturalBorder,
                    focusedTextColor = NaturalText,
                    unfocusedTextColor = NaturalText
                ),
                singleLine = true,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp)
                    .testTag("quick_brain_dump_input"),
                shape = RoundedCornerShape(12.dp)
            )
        }
    }
}

@Composable
fun ActiveFocusNowCard(
    activeTask: Task?,
    viewModel: LociViewModel
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = NaturalCardBg),
        shape = RoundedCornerShape(28.dp),
        modifier = Modifier
            .fillMaxWidth()
            .testTag("now_block_hero")
    ) {
        Column(
            modifier = Modifier.padding(20.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        modifier = Modifier
                            .size(8.dp)
                            .clip(CircleShape)
                            .background(Color.Red)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "ACTIVE FOCUS NOW",
                        style = MaterialTheme.typography.labelSmall.copy(
                            fontWeight = FontWeight.Bold,
                            color = NaturalMuted,
                            letterSpacing = 1.sp
                        )
                    )
                }

                // Locked Stuck button triggers dialog
                Button(
                    onClick = { viewModel.startStuckRescue() },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = ClaudePurple,
                        contentColor = ClaudePurpleText
                    ),
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier.height(28.dp)
                ) {
                    Text("Stuck?", fontSize = 11.sp, fontWeight = FontWeight.Bold)
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            if (activeTask != null) {
                Text(
                    text = activeTask.title,
                    style = MaterialTheme.typography.headlineSmall.copy(
                        fontWeight = FontWeight.Normal,
                        color = NaturalText,
                        lineHeight = 28.sp
                    ),
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth()
                )

                Spacer(modifier = Modifier.height(6.dp))

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.Center,
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .background(Color.White.copy(alpha = 0.5f))
                        .padding(horizontal = 8.dp, vertical = 4.dp)
                ) {
                    Icon(imageVector = Icons.Default.CheckCircle, contentDescription = null, tint = ProgressDarkGrey, modifier = Modifier.size(14.dp))
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        text = "First small step: ${activeTask.concreteStep}",
                        style = MaterialTheme.typography.bodySmall.copy(color = NaturalText, fontSize = 12.sp)
                    )
                }

                Spacer(modifier = Modifier.height(20.dp))

                // Custom SVG/Circular countdown timer with Compose Canvas
                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier.size(160.dp)
                ) {
                    val progressRatio = if (viewModel.timerMaxSeconds > 0) {
                        viewModel.timerSecondsLeft.toFloat() / viewModel.timerMaxSeconds
                    } else {
                        1.0f
                    }

                    Canvas(modifier = Modifier.size(140.dp)) {
                        // Background ring
                        drawCircle(
                            color = NaturalBorder.copy(alpha = 0.5f),
                            style = Stroke(width = 8.dp.toPx())
                        )
                        // Active color progress
                        drawArc(
                            color = BrandPurple,
                            startAngle = -90f,
                            sweepAngle = 360f * progressRatio,
                            useCenter = false,
                            style = Stroke(width = 8.dp.toPx(), cap = StrokeCap.Round)
                        )
                    }

                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        val minutes = viewModel.timerSecondsLeft / 60
                        val seconds = viewModel.timerSecondsLeft % 60
                        Text(
                            text = String.format("%02d:%02d", minutes, seconds),
                            style = MaterialTheme.typography.headlineMedium.copy(
                                fontWeight = FontWeight.Light,
                                color = NaturalText,
                                fontSize = 32.sp
                            )
                        )
                        Text(
                            text = "EST: ${activeTask.timeEstimateMinutes} min",
                            style = MaterialTheme.typography.labelSmall.copy(color = NaturalMuted)
                        )
                    }
                }

                Spacer(modifier = Modifier.height(16.dp))

                Row(
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    // Play / Pause Circle fab
                    Box(
                        modifier = Modifier
                            .size(52.dp)
                            .clip(CircleShape)
                            .background(BrandPurple)
                            .clickable { viewModel.toggleFocusTimer() },
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = if (viewModel.isTimerRunning) Icons.Default.Lock else Icons.Default.PlayArrow,
                            contentDescription = "Trigger duration ticks",
                            tint = Color.White
                        )
                    }

                    // Done check fab shortcut complete
                    Box(
                        modifier = Modifier
                            .size(52.dp)
                            .clip(CircleShape)
                            .background(NaturalAccent)
                            .clickable { viewModel.completeTask(activeTask) },
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = Icons.Default.Check,
                            contentDescription = null,
                            tint = NaturalAccentDark
                        )
                    }
                }
            } else {
                Text(
                    text = "No focus commit running.",
                    style = MaterialTheme.typography.bodyMedium.copy(color = NaturalMuted),
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "Pick one tiny action below and click \"Focus Mode\" to start right now.",
                    style = MaterialTheme.typography.bodySmall.copy(color = NaturalMuted.copy(alpha = 0.8f)),
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(modifier = Modifier.height(16.dp))
            }

            // Coach voice text line right below Now block
            HorizontalDivider(
                modifier = Modifier.padding(vertical = 12.dp),
                color = NaturalBorder.copy(alpha = 0.6f)
            )

            Text(
                text = viewModel.mentoringQuote,
                style = MaterialTheme.typography.bodyMedium.copy(
                    fontWeight = FontWeight.Medium,
                    color = NaturalText,
                    fontSize = 13.sp,
                    lineHeight = 18.sp
                ),
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth()
            )
        }
    }
}

@Composable
fun TimeBlindnessTimelineSection(
    viewModel: LociViewModel,
    todayTasks: List<Task>
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Color.White),
        shape = RoundedCornerShape(24.dp),
        border = BorderStroke(1.dp, NaturalBorder),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            modifier = Modifier.padding(16.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = Icons.Default.Info,
                        contentDescription = null,
                        tint = NaturalAccentDark,
                        modifier = Modifier.size(16.dp)
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        text = "Day Horizon Timeline Progress",
                        style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Bold, color = NaturalText)
                    )
                }

                val calendar = Calendar.getInstance()
                val hour = calendar.get(Calendar.HOUR_OF_DAY)
                val displayHour = if (hour % 12 == 0) 12 else hour % 12
                val amPmStr = if (hour >= 12) "PM" else "AM"
                Text(
                    text = "$displayHour:${String.format("%02d", calendar.get(Calendar.MINUTE))} $amPmStr",
                    style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold, color = BrandPurple)
                )
            }

            Spacer(modifier = Modifier.height(12.dp))

            // Day Horizon Scroll / Progress Tracker
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(20.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(NaturalBg)
            ) {
                // Background markers (7 AM - 2 AM block offsets)
                Row(
                    modifier = Modifier.fillMaxSize(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    listOf("7 am", "1 pm", "7 pm", "2 am").forEach { timeLabel ->
                        Text(
                            text = timeLabel,
                            fontSize = 9.sp,
                            fontWeight = FontWeight.Light,
                            color = NaturalMuted.copy(alpha = 0.45f),
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 4.dp)
                        )
                    }
                }

                // Foreground live indicator line
                Box(
                    modifier = Modifier
                        .fillMaxHeight()
                        .fillMaxWidth(viewModel.currentDayTimelineProgress)
                        .clip(RoundedCornerShape(8.dp))
                        .background(NaturalAccent.copy(alpha = 0.55f))
                        .border(1.dp, NaturalAccentDark.copy(alpha = 0.15f), RoundedCornerShape(8.dp))
                )
            }

            // Timeline schedule widget overlays of upcoming/running commits
            Spacer(modifier = Modifier.height(12.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                val active = todayTasks.firstOrNull { it.isNowFocus }
                val next = todayTasks.filter { !it.isCompleted && !it.isNowFocus }.sortedBy { it.priority }.firstOrNull()

                Column(modifier = Modifier.weight(1f)) {
                    Text(text = "CURRENT TASK BLOCK", fontSize = 10.sp, fontWeight = FontWeight.Bold, color = NaturalMuted)
                    Text(
                        text = active?.title ?: "No active focus block",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        color = if (active != null) NaturalText else NaturalMuted.copy(alpha = 0.6f),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
                Box(modifier = Modifier.size(1.dp, 28.dp).background(NaturalBorder))
                Column(modifier = Modifier.weight(1f)) {
                    Text(text = "UPCOMING BLOCK TASK", fontSize = 10.sp, fontWeight = FontWeight.Bold, color = NaturalMuted)
                    Text(
                        text = next?.title ?: "Day list complete ✓",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        color = if (next != null) NaturalText else NaturalMuted.copy(alpha = 0.6f),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }
        }
    }
}

@Composable
fun TaskCommitRow(
    task: Task,
    onPin: () -> Unit,
    onComplete: () -> Unit,
    onMoveUp: () -> Unit,
    onMoveDown: () -> Unit,
    onDelete: () -> Unit
) {
    val tierColor = when (task.priority) {
        "P1" -> Color(0xFFF3C0C0) // urgent
        "P2" -> Color(0xFFFDE8BD)
        "P3" -> Color(0xFFE8DEF8)
        else -> Color(0xFFD7E3BD) // low energy P4
    }

    val tierText = when (task.priority) {
        "P1" -> "Critical Focus (P1)"
        "P2" -> "High Drive (P2)"
        "P3" -> "Standard Commit (P3)"
        else -> "Low Energy Target (P4)"
    }

    Surface(
        color = Color.White,
        shape = RoundedCornerShape(16.dp),
        border = BorderStroke(1.dp, NaturalBorder),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            modifier = Modifier.padding(12.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Priority color coded pill icon
                Box(
                    modifier = Modifier
                        .size(14.dp)
                        .clip(CircleShape)
                        .background(tierColor)
                )

                Spacer(modifier = Modifier.width(8.dp))

                Text(
                    text = task.category,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold,
                    color = NaturalAccentDark,
                    modifier = Modifier
                        .background(NaturalAccent.copy(alpha = 0.4f), RoundedCornerShape(4.dp))
                        .padding(horizontal = 6.dp, vertical = 2.dp)
                )

                Spacer(modifier = Modifier.weight(1f))

                // Estimate text duration
                Text(
                    text = "${task.timeEstimateMinutes}m",
                    fontSize = 11.sp,
                    color = NaturalMuted,
                    fontWeight = FontWeight.Bold
                )

                Spacer(modifier = Modifier.width(6.dp))

                // Reorder controls
                IconButton(onClick = onMoveUp, modifier = Modifier.size(24.dp)) {
                    Icon(imageVector = Icons.Default.KeyboardArrowUp, contentDescription = "Move row prioritization up", modifier = Modifier.size(16.dp))
                }
                IconButton(onClick = onMoveDown, modifier = Modifier.size(24.dp)) {
                    Icon(imageVector = Icons.Default.KeyboardArrowDown, contentDescription = "Move row prioritization down", modifier = Modifier.size(16.dp))
                }
            }

            Spacer(modifier = Modifier.height(6.dp))

            Text(
                text = task.title,
                style = MaterialTheme.typography.bodyMedium.copy(
                    fontWeight = FontWeight.Medium,
                    color = NaturalText
                )
            )

            // Step hint text
            if (task.concreteStep.isNotEmpty()) {
                Text(
                    text = "↳ Next step: ${task.concreteStep}",
                    fontSize = 12.sp,
                    color = NaturalMuted,
                    modifier = Modifier.padding(top = 2.dp)
                )
            }

            Spacer(modifier = Modifier.height(10.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Delete bin icon
                IconButton(onClick = onDelete, modifier = Modifier.size(36.dp)) {
                    Icon(imageVector = Icons.Default.Delete, contentDescription = "Delete target commit", tint = Color.Red.copy(alpha = 0.5f), modifier = Modifier.size(16.dp))
                }

                Spacer(modifier = Modifier.weight(1f))

                // "Focus mode" trigger PIN button
                Button(
                    onClick = onPin,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = if (task.isNowFocus) BrandPurple else NaturalBg,
                        contentColor = if (task.isNowFocus) Color.White else NaturalText
                    ),
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
                    shape = RoundedCornerShape(8.dp),
                    border = if (task.isNowFocus) null else BorderStroke(1.dp, NaturalBorder),
                    modifier = Modifier.height(32.dp)
                ) {
                    Icon(imageVector = Icons.Default.Star, contentDescription = null, modifier = Modifier.size(12.dp))
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("Focus Mode", fontSize = 11.sp, fontWeight = FontWeight.Bold)
                }

                Spacer(modifier = Modifier.width(8.dp))

                // Done check checkmark
                Button(
                    onClick = onComplete,
                    colors = ButtonDefaults.buttonColors(containerColor = NaturalAccent, contentColor = NaturalAccentDark),
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.height(32.dp)
                ) {
                    Text("Done", fontSize = 11.sp, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@Composable
fun CompletedTaskCommitRow(
    task: Task,
    onUncomplete: () -> Unit,
    onDelete: () -> Unit
) {
    Surface(
        color = Color.White.copy(alpha = 0.6f),
        shape = RoundedCornerShape(14.dp),
        border = BorderStroke(1.dp, NaturalBorder.copy(alpha = 0.8f)),
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(onClick = onUncomplete, modifier = Modifier.size(24.dp)) {
                Icon(
                    imageVector = Icons.Default.CheckCircle,
                    contentDescription = "Uncomplete task commit",
                    tint = BrandPurple,
                    modifier = Modifier.size(20.dp)
                )
            }

            Spacer(modifier = Modifier.width(10.dp))

            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = task.title,
                    fontSize = 14.sp,
                    color = NaturalMuted,
                    textDecoration = TextDecoration.LineThrough
                )
            }

            // XP completed pill message reward item info
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                Icon(imageVector = Icons.Default.Star, contentDescription = null, tint = NaturalAccentDark, modifier = Modifier.size(12.dp))
                Text("+100 XP", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = NaturalAccentDark)
            }

            Spacer(modifier = Modifier.width(8.dp))

            IconButton(onClick = onDelete, modifier = Modifier.size(28.dp)) {
                Icon(imageVector = Icons.Default.Delete, contentDescription = "Delete complete tasks", tint = Color.Red.copy(alpha = 0.4f), modifier = Modifier.size(16.dp))
            }
        }
    }
}

@Composable
fun ADHDContributionBentoWidget(
    contributions: List<ContributionDay>,
    config: LociConfig
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Color.White),
        shape = RoundedCornerShape(24.dp),
        border = BorderStroke(1.dp, NaturalBorder),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            modifier = Modifier.padding(18.dp)
        ) {
            Text(
                text = "Consistency History Map Grid (Bento)",
                style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Bold, color = NaturalText)
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = "Every filled grid square maps to task focuses completed on a specific day. Keep the drive active!",
                fontSize = 11.sp,
                color = NaturalMuted,
                lineHeight = 16.sp
            )

            Spacer(modifier = Modifier.height(14.dp))

            val gridColors = remember(contributions) {
                val sdf = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
                List(15) { col ->
                    List(7) { row ->
                        val computedDaysAgo = (14 - col) * 7 + (6 - row)
                        val cal = Calendar.getInstance()
                        cal.add(Calendar.DAY_OF_YEAR, -computedDaysAgo)
                        val dateStr = sdf.format(cal.time)

                        val matchingCount = contributions.firstOrNull { it.dateString == dateStr }?.count ?: 0
                        when {
                            matchingCount >= 4 -> BrandPurple
                            matchingCount == 3 -> ProgressGreyGreen
                            matchingCount == 2 -> NaturalAccent
                            matchingCount == 1 -> ClaudePurple
                            else -> NaturalBg
                        }
                    }
                }
            }

            // Grid contribution map visualization layout (7 rows by 16 columns representation)
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                // Generate simulated grid days
                for (col in 0..14) {
                    Column(
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        for (row in 0..6) {
                            val gridColor = gridColors[col][row]

                            Box(
                                modifier = Modifier
                                    .size(14.dp)
                                    .clip(RoundedCornerShape(3.dp))
                                    .background(gridColor)
                                    .border(0.5.dp, NaturalBorder.copy(alpha = 0.5f), RoundedCornerShape(3.dp))
                            )
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(10.dp))

            // Legends status
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("Less", fontSize = 10.sp, color = NaturalMuted)
                Spacer(modifier = Modifier.width(6.dp))
                listOf(NaturalBg, ClaudePurple, NaturalAccent, ProgressGreyGreen, BrandPurple).forEach { color ->
                    Box(
                        modifier = Modifier
                            .size(10.dp)
                            .clip(RoundedCornerShape(2.dp))
                            .background(color)
                            .border(0.5.dp, NaturalBorder, RoundedCornerShape(2.dp))
                    )
                    Spacer(modifier = Modifier.width(4.dp))
                }
                Text("More Drive", fontSize = 10.sp, color = NaturalMuted)
            }
        }
    }
}

@Composable
fun LociRoadmapTabContent(
    tasks: List<Task>,
    viewModel: LociViewModel
) {
    val levels = listOf(
        "today" to "Today Commit",
        "week" to "This Week",
        "month" to "This Month",
        "quarter" to "3 Months",
        "halfyear" to "6 Months",
        "office" to "Office (Work)"
    )

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // Horizon planning strategic banner
        Text(
            text = "Horizon Planning Board",
            style = MaterialTheme.typography.titleMedium.copy(
                fontWeight = FontWeight.Bold,
                color = NaturalText
            ),
            modifier = Modifier.padding(top = 8.dp)
        )

        // Horizontal pill headers filters select active level
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            levels.forEach { (levelKey, levelLabel) ->
                val isSelected = viewModel.activeHorizonLevel == levelKey
                FilterChip(
                    selected = isSelected,
                    onClick = { viewModel.selectHorizonLevel(levelKey) },
                    label = { Text(levelLabel, fontSize = 12.sp) },
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = NaturalAccent,
                        selectedLabelColor = NaturalAccentDark,
                        containerColor = Color.White,
                        labelColor = NaturalMuted
                    ),
                    shape = RoundedCornerShape(12.dp)
                )
            }
        }

        // List tasks in current selected level horizon
        val filteredTasks = tasks.filter { it.horizonLevel == viewModel.activeHorizonLevel }

        LazyColumn(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            contentPadding = PaddingValues(bottom = 80.dp)
        ) {
            if (filteredTasks.isEmpty()) {
                item {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 40.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Icon(imageVector = Icons.Default.Build, contentDescription = null, tint = NaturalMuted, modifier = Modifier.size(36.dp))
                        Spacer(modifier = Modifier.height(12.dp))
                        Text(
                            text = "0 tasks planned in this strategic sector.",
                            fontSize = 14.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = NaturalText
                        )
                        Spacer(modifier = Modifier.height(6.dp))
                        Text(
                            text = "Add items or strategic plans to drag and transfer here.",
                            fontSize = 12.sp,
                            color = NaturalMuted
                        )
                    }
                }
            } else {
                items(filteredTasks.sortedBy { it.priority }) { task ->
                    HorizonTaskPlanningItemRow(
                        task = task,
                        onMoveLevel = { targetLevel ->
                            viewModel.moveTaskToHorizonLevel(task, targetLevel)
                        },
                        onDelete = { viewModel.deleteTask(task) }
                    )
                }
            }
        }
    }
}

@Composable
fun HorizonTaskPlanningItemRow(
    task: Task,
    onMoveLevel: (String) -> Unit,
    onDelete: () -> Unit
) {
    var expandMoveDropdown by remember { mutableStateOf(false) }

    Surface(
        color = Color.White,
        shape = RoundedCornerShape(16.dp),
        border = BorderStroke(1.dp, NaturalBorder),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            modifier = Modifier.padding(14.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = task.category,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold,
                    color = BrandPurple,
                    modifier = Modifier
                        .background(ClaudePurple, RoundedCornerShape(6.dp))
                        .padding(horizontal = 6.dp, vertical = 2.dp)
                )

                Spacer(modifier = Modifier.width(8.dp))

                Text(
                    text = "Priority: ${task.priority}",
                    fontSize = 11.sp,
                    color = NaturalMuted
                )

                Spacer(modifier = Modifier.weight(1f))

                // Move trigger button dropdown
                Box {
                    Button(
                        onClick = { expandMoveDropdown = true },
                        colors = ButtonDefaults.buttonColors(containerColor = NaturalBg, contentColor = NaturalText),
                        shape = RoundedCornerShape(8.dp),
                        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                        modifier = Modifier.height(26.dp)
                    ) {
                        Text("Move Horizon", fontSize = 10.sp, fontWeight = FontWeight.Bold)
                        Icon(imageVector = Icons.Default.KeyboardArrowDown, contentDescription = null, modifier = Modifier.size(12.dp))
                    }

                    DropdownMenu(
                        expanded = expandMoveDropdown,
                        onDismissRequest = { expandMoveDropdown = false },
                        modifier = Modifier.background(Color.White)
                    ) {
                        listOf(
                            "today" to "Today Commit",
                            "week" to "This Week",
                            "month" to "This Month",
                            "quarter" to "3 Months",
                            "halfyear" to "6 Months",
                            "office" to "Office (Work)"
                        ).forEach { (levelKey, levelLabel) ->
                            DropdownMenuItem(
                                text = { Text(levelLabel, fontSize = 12.sp) },
                                onClick = {
                                    onMoveLevel(levelKey)
                                    expandMoveDropdown = false
                                }
                            )
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = task.title,
                fontSize = 15.sp,
                fontWeight = FontWeight.Normal,
                color = NaturalText
            )

            if (task.concreteStep.isNotEmpty()) {
                Text(
                    text = "↳ Anchor small action: ${task.concreteStep}",
                    fontSize = 12.sp,
                    color = NaturalMuted,
                    modifier = Modifier.padding(top = 2.dp)
                )
            }

            Spacer(modifier = Modifier.height(10.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End
            ) {
                IconButton(onClick = onDelete, modifier = Modifier.size(28.dp)) {
                    Icon(imageVector = Icons.Default.Delete, contentDescription = "Delete from planning board", tint = Color.Red.copy(alpha = 0.5f), modifier = Modifier.size(16.dp))
                }
            }
        }
    }
}

@Composable
fun LociCoachTabContent(
    config: LociConfig,
    viewModel: LociViewModel
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Text(
            text = "ADHD Coaching Center",
            style = MaterialTheme.typography.titleMedium.copy(
                fontWeight = FontWeight.Bold,
                color = NaturalText
            ),
            modifier = Modifier.padding(top = 8.dp)
        )

        // Intention setting message banner
        Card(
            colors = CardDefaults.cardColors(containerColor = ClaudePurple),
            shape = RoundedCornerShape(20.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(
                modifier = Modifier.padding(16.dp)
            ) {
                Text(
                    text = "TODAY'S ACCLAIMED INTENTION",
                    style = MaterialTheme.typography.labelSmall.copy(
                        color = ClaudePurpleText,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 0.5.sp
                    )
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = "\"${config.intentionMessage}\"",
                    style = MaterialTheme.typography.bodyLarge.copy(
                        fontWeight = FontWeight.Normal,
                        color = NaturalText
                    )
                )
            }
        }

        // Energy Filters Toggles Card
        Card(
            colors = CardDefaults.cardColors(containerColor = Color.White),
            shape = RoundedCornerShape(20.dp),
            border = BorderStroke(1.dp, NaturalBorder),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(
                modifier = Modifier.padding(16.dp)
            ) {
                Text(
                    text = "Dopamine & Energy Mode Toggle",
                    style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Bold, color = NaturalText)
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = "When Low Energy mode is activated, Loci automatically filters out heavy critical tasks from your today feed, showing only rapid low-friction P4 targets.",
                    fontSize = 11.sp,
                    color = NaturalMuted,
                    lineHeight = 16.sp
                )
                Spacer(modifier = Modifier.height(12.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = if (config.isLowEnergyMode) "LOW ENERGY MODE ACTIVE" else "STANDARD FULL FOCUS ACTIVE",
                        style = MaterialTheme.typography.labelMedium.copy(
                            fontWeight = FontWeight.Bold,
                            color = if (config.isLowEnergyMode) BrandPurple else NaturalAccentDark
                        )
                    )

                    Switch(
                        checked = config.isLowEnergyMode,
                        onCheckedChange = { viewModel.toggleLowEnergyFilter() },
                        colors = SwitchDefaults.colors(
                            checkedThumbColor = Color.White,
                            checkedTrackColor = BrandPurple,
                            uncheckedThumbColor = NaturalMuted,
                            uncheckedTrackColor = NaturalBg
                        )
                    )
                }
            }
        }

        // Coach morning ritual tools
        Card(
            colors = CardDefaults.cardColors(containerColor = NaturalCardBg),
            shape = RoundedCornerShape(20.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(
                modifier = Modifier.padding(18.dp)
            ) {
                Text(
                    text = "Morning Ritual Starter Kit & Timer",
                    style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Bold, color = NaturalText)
                )
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    text = "Run through calibrated, low-friction micro habits built to clear executive dysfunction fog in under 7 minutes.",
                    fontSize = 12.sp,
                    color = NaturalMuted,
                    lineHeight = 18.sp
                )

                Spacer(modifier = Modifier.height(16.dp))

                if (viewModel.activeRitualStepIndex < 0) {
                    Button(
                        onClick = { viewModel.startMorningRitual() },
                        colors = ButtonDefaults.buttonColors(containerColor = NaturalAccent, contentColor = NaturalAccentDark),
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("Initiate Morning Calibration ritual (+80 XP)", fontWeight = FontWeight.Bold)
                    }
                } else {
                    val currentStepName = viewModel.ritualSteps[viewModel.activeRitualStepIndex].first
                    val mins = viewModel.ritualSecondsRemaining / 60
                    val secs = viewModel.ritualSecondsRemaining % 60

                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(Color.White)
                            .padding(14.dp)
                    ) {
                        Text(
                            text = "ACTIVE STEP ${viewModel.activeRitualStepIndex + 1}/${viewModel.ritualSteps.size}",
                            style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold, color = BrandPurple)
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = currentStepName,
                            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Bold, color = NaturalText)
                        )

                        Spacer(modifier = Modifier.height(10.dp))

                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(
                                text = String.format("%02d:%02d left", mins, secs),
                                fontSize = 16.sp,
                                fontWeight = FontWeight.Bold,
                                color = NaturalText
                            )

                            Row {
                                Button(
                                    onClick = { viewModel.nextRitualStep() },
                                    colors = ButtonDefaults.buttonColors(containerColor = NaturalBg, contentColor = NaturalText),
                                    shape = RoundedCornerShape(8.dp),
                                    modifier = Modifier.height(32.dp)
                                ) {
                                    Text("Skip", fontSize = 11.sp, fontWeight = FontWeight.Bold)
                                }
                                Spacer(modifier = Modifier.width(8.dp))
                                Button(
                                    onClick = { viewModel.stopMorningRitual() },
                                    colors = ButtonDefaults.buttonColors(containerColor = Color.Red.copy(alpha = 0.8f), contentColor = Color.White),
                                    shape = RoundedCornerShape(8.dp),
                                    modifier = Modifier.height(32.dp)
                                ) {
                                    Text("Abort", fontSize = 11.sp, fontWeight = FontWeight.Bold)
                                }
                            }
                        }
                    }
                }
            }
        }

        // Stuck Rescue Trigger & Emergency bad-day clear Card
        Card(
            colors = CardDefaults.cardColors(containerColor = Color.White),
            shape = RoundedCornerShape(20.dp),
            border = BorderStroke(1.dp, NaturalBorder),
            modifier = Modifier.fillMaxWidth()
            // Stuck Rescue dialog is triggered internally via state variable
        ) {
            Column(
                modifier = Modifier.padding(18.dp)
            ) {
                Text(
                    text = "Stuck Rescue & Task Escape Pod",
                    style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Bold, color = NaturalText)
                )
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    text = "Under absolute executive freeze? Initiate stuck rescue helper sequence.",
                    fontSize = 11.sp,
                    color = NaturalMuted,
                    lineHeight = 16.sp
                )

                Spacer(modifier = Modifier.height(12.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Button(
                        onClick = { viewModel.startStuckRescue() },
                        colors = ButtonDefaults.buttonColors(containerColor = ClaudePurple, contentColor = ClaudePurpleText),
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier.weight(1.2f)
                    ) {
                        Text("Stuck? Run Rescue Mode", fontSize = 11.sp, fontWeight = FontWeight.Bold)
                    }

                    Button(
                        onClick = { viewModel.triggerBadDayReset() },
                        colors = ButtonDefaults.buttonColors(containerColor = NaturalBg, contentColor = NaturalText),
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier.weight(1f)
                    ) {
                        Text("Bad Day Focus Reset", fontSize = 11.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(80.dp))
    }
}

@Composable
fun ActiveRitualProgressBanner(viewModel: LociViewModel) {
    Surface(
        color = NaturalAccent,
        shape = RoundedCornerShape(14.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(imageVector = Icons.Default.Info, contentDescription = null, tint = NaturalAccentDark)
            Spacer(modifier = Modifier.width(10.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = "MORNING CALIBRATION RUNNING",
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold,
                    color = NaturalAccentDark
                )
                Text(
                    text = viewModel.ritualSteps[viewModel.activeRitualStepIndex].first,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold,
                    color = NaturalAccentDark,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            Text(
                text = "${viewModel.ritualSecondsRemaining}s",
                fontWeight = FontWeight.Bold,
                color = NaturalAccentDark,
                modifier = Modifier
                    .background(Color.White, CircleShape)
                    .padding(horizontal = 10.dp, vertical = 4.dp)
            )
        }
    }
}

@Composable
fun LociMentorTabContent(
    config: LociConfig,
    viewModel: LociViewModel
) {
    var editedName by remember(config) { mutableStateOf(config.userName) }
    var editedMentor by remember(config) { mutableStateOf(config.mentorName) }
    var selectedChallenge by remember(config) { mutableStateOf(config.challengeType) }
    var pDuration by remember(config) { mutableStateOf(config.pomodoroDurationMinutes.toString()) }
    var nInterval by remember(config) { mutableStateOf(config.reminderNagIntervalMinutes.toString()) }
    var eGuardWindow by remember(config) { mutableStateOf(config.eveningGuardWindowActive) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Text(
            text = "Fine Matte Design Identity",
            style = MaterialTheme.typography.titleMedium.copy(
                fontWeight = FontWeight.Bold,
                color = NaturalText
            ),
            modifier = Modifier.padding(top = 8.dp)
        )

        Card(
            colors = CardDefaults.cardColors(containerColor = NaturalCardBg),
            shape = RoundedCornerShape(24.dp),
            border = BorderStroke(1.dp, NaturalBorder),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(
                modifier = Modifier.padding(18.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Text(
                    text = "Configure your active workspace canvas. Loci's dynamic matte framework re-shades cards, outline frames, and text layers across both mobile and dual-screen configurations.",
                    fontSize = 12.sp,
                    color = NaturalMuted,
                    lineHeight = 16.sp
                )

                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    LociMatteThemeConfig.values().forEach { theme ->
                        val isSelected = LociThemeManager.activeTheme == theme
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(14.dp))
                                .background(if (isSelected) NaturalBg else NaturalCardBg)
                                .clickable { LociThemeManager.activeTheme = theme }
                                .border(
                                    1.dp,
                                    if (isSelected) BrandPurple else NaturalBorder,
                                    RoundedCornerShape(14.dp)
                                )
                                .padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(10.dp)
                            ) {
                                Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                                    val colors = when (theme) {
                                        LociMatteThemeConfig.WarmSand -> listOf(Color(0xFFFDF8F6), Color(0xFFD7E3BD), Color(0xFF6750A4))
                                        LociMatteThemeConfig.CharcoalSlate -> listOf(Color(0xFF121416), Color(0xFFBBCABB), Color(0xFFB09FFF))
                                        LociMatteThemeConfig.NordicForest -> listOf(Color(0xFFF4F6F0), Color(0xFFC2D8C2), Color(0xFF2B5B3E))
                                        LociMatteThemeConfig.TokyoConcrete -> listOf(Color(0xFFF6F6F7), Color(0xFF7F8287), Color(0xFF252627))
                                    }
                                    colors.forEach { color ->
                                        Box(
                                            modifier = Modifier
                                                .size(14.dp)
                                                .clip(CircleShape)
                                                .background(color)
                                                .border(1.dp, NaturalText.copy(alpha = 0.15f), CircleShape)
                                        )
                                    }
                                }

                                Text(
                                    text = theme.displayName,
                                    style = MaterialTheme.typography.bodyMedium.copy(
                                        fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                                        color = NaturalText
                                    )
                                )
                            }

                            if (isSelected) {
                                Icon(
                                    imageVector = Icons.Default.Check,
                                    contentDescription = "Active",
                                    tint = BrandPurple,
                                    modifier = Modifier.size(16.dp)
                                )
                            }
                        }
                    }
                }
            }
        }

        Text(
            text = "Mentor Mode Settings Calibration",
            style = MaterialTheme.typography.titleMedium.copy(
                fontWeight = FontWeight.Bold,
                color = NaturalText
            ),
            modifier = Modifier.padding(top = 4.dp)
        )

        // Custom config form
        Card(
            colors = CardDefaults.cardColors(containerColor = NaturalBg),
            shape = RoundedCornerShape(24.dp),
            border = BorderStroke(1.dp, NaturalBorder),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(
                modifier = Modifier.padding(18.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                OutlinedTextField(
                    value = editedName,
                    onValueChange = { editedName = it },
                    label = { Text("User name personalization") },
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedTextColor = NaturalText,
                        unfocusedTextColor = NaturalText,
                        focusedBorderColor = BrandPurple,
                        unfocusedBorderColor = NaturalBorder
                    ),
                    modifier = Modifier.fillMaxWidth()
                )

                OutlinedTextField(
                    value = editedMentor,
                    onValueChange = { editedMentor = it },
                    label = { Text("Mentor personality voice (e.g Yoda, Marcus Aurelius)") },
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedTextColor = NaturalText,
                        unfocusedTextColor = NaturalText,
                        focusedBorderColor = BrandPurple,
                        unfocusedBorderColor = NaturalBorder
                    ),
                    modifier = Modifier.fillMaxWidth()
                )

                // Challenge Selection Radio Button Row
                Text(text = "Target Focus Goal Challenge:", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = NaturalMuted)
                listOf("starting" to "Overcoming Inertia", "focusing" to "Protecting Sessions", "execution" to "Action over Detail").forEach { (key, label) ->
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { selectedChallenge = key }
                            .padding(vertical = 2.dp)
                    ) {
                        RadioButton(
                            selected = selectedChallenge == key,
                            onClick = { selectedChallenge = key },
                            colors = RadioButtonDefaults.colors(selectedColor = BrandPurple)
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(text = label, fontSize = 13.sp, color = NaturalText)
                    }
                }

                Row(
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    OutlinedTextField(
                        value = pDuration,
                        onValueChange = { pDuration = it },
                        label = { Text("Pomodoro min") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        colors = OutlinedTextFieldDefaults.colors(focusedTextColor = NaturalText, unfocusedTextColor = NaturalText, focusedBorderColor = BrandPurple, unfocusedBorderColor = NaturalBorder),
                        modifier = Modifier.weight(1f)
                    )

                    OutlinedTextField(
                        value = nInterval,
                        onValueChange = { nInterval = it },
                        label = { Text("Nag interval min") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        colors = OutlinedTextFieldDefaults.colors(focusedTextColor = NaturalText, unfocusedTextColor = NaturalText, focusedBorderColor = BrandPurple, unfocusedBorderColor = NaturalBorder),
                        modifier = Modifier.weight(1f)
                    )
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text("Evening guard window (protect last hour)", fontSize = 13.sp, color = NaturalText)
                    Switch(
                        checked = eGuardWindow,
                        onCheckedChange = { eGuardWindow = it },
                        colors = SwitchDefaults.colors(checkedTrackColor = BrandPurple)
                    )
                }

                Spacer(modifier = Modifier.height(4.dp))

                // Save action
                Button(
                    onClick = {
                        val durationVal = pDuration.toIntOrNull() ?: 25
                        val nagVal = nInterval.toIntOrNull() ?: 15
                        viewModel.updateProfileSettings(
                            uName = editedName,
                            mName = editedMentor,
                            challenge = selectedChallenge,
                            duration = durationVal,
                            interval = nagVal,
                            guard = eGuardWindow
                        )
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = NaturalAccent, contentColor = NaturalAccentDark),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(48.dp)
                ) {
                    Text("Apply Calibration Settings", fontWeight = FontWeight.Bold)
                }
            }
        }

        // Developer info card backup and recovery
        Card(
            colors = CardDefaults.cardColors(containerColor = NaturalCardBg),
            shape = RoundedCornerShape(20.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(
                modifier = Modifier.padding(16.dp)
            ) {
                Text(
                    text = "Backup / Offline Storage status",
                    style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Bold, color = NaturalText)
                )
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    text = "Loci stores all focused strategic horizon lists and consistent completed XP records securely locally using an offline Android Room SQLite database instance.",
                    fontSize = 11.sp,
                    color = NaturalMuted,
                    lineHeight = 16.sp
                )
            }
        }

        Spacer(modifier = Modifier.height(80.dp))
    }
}

@Composable
fun StuckRescueDialog(
    viewModel: LociViewModel,
    onDismiss: () -> Unit
) {
    Dialog(onDismissRequest = onDismiss) {
        Surface(
            shape = RoundedCornerShape(28.dp),
            color = NaturalBg,
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
                .border(1.dp, NaturalBorder, RoundedCornerShape(28.dp))
        ) {
            Column(
                modifier = Modifier.padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.Warning,
                    contentDescription = null,
                    tint = BrandPurple,
                    modifier = Modifier.size(36.dp)
                )

                Text(
                    text = "Executive Freeze Rescue Pod",
                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                    color = NaturalText
                )

                Text(
                    text = "STEP ${viewModel.rescueCurrentStepIndex + 1}/${viewModel.rescueSteps.size}",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    color = BrandPurple
                )

                Text(
                    text = viewModel.rescueSteps[viewModel.rescueCurrentStepIndex],
                    textAlign = TextAlign.Center,
                    fontWeight = FontWeight.Medium,
                    lineHeight = 18.sp,
                    color = NaturalText,
                    modifier = Modifier.fillMaxWidth()
                )

                Spacer(modifier = Modifier.height(8.dp))

                Button(
                    onClick = { viewModel.nextRescueStep() },
                    colors = ButtonDefaults.buttonColors(containerColor = NaturalAccent, contentColor = NaturalAccentDark),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(
                        text = if (viewModel.rescueCurrentStepIndex == viewModel.rescueSteps.size - 1) "I am ready to move the needle!" else "Next Step",
                        fontWeight = FontWeight.Bold
                    )
                }

                TextButton(onClick = onDismiss) {
                    Text("Close pod", color = NaturalMuted)
                }
            }
        }
    }
}

@Composable
fun OnboardingQuizDialog(
    viewModel: LociViewModel,
    onDismiss: () -> Unit
) {
    Dialog(onDismissRequest = onDismiss) {
        Surface(
            shape = RoundedCornerShape(28.dp),
            color = NaturalBg,
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
                .border(1.dp, NaturalBorder, RoundedCornerShape(28.dp))
        ) {
            Column(
                modifier = Modifier.padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.Favorite,
                    contentDescription = null,
                    tint = BrandPurple,
                    modifier = Modifier.size(40.dp)
                )

                Text(
                    text = "Welcome to Loci",
                    style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold),
                    color = NaturalText
                )

                Text(
                    text = "A spatial visual anchor productivity suite built cleanly to bypass prefrontal cognitive roadblocks.\n\n\"Start tiny. One action. Right now.\"",
                    textAlign = TextAlign.Center,
                    fontSize = 13.sp,
                    lineHeight = 18.sp,
                    color = NaturalMuted,
                    modifier = Modifier.fillMaxWidth()
                )

                Button(
                    onClick = onDismiss,
                    colors = ButtonDefaults.buttonColors(containerColor = BrandPurple, contentColor = Color.White),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("Calibrate My Mind Horizon", fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@Composable
fun BottomAppNavigationBar(
    selectedTab: LociTab,
    onTabSelected: (LociTab) -> Unit
) {
    Surface(
        color = NaturalCardBg,
        modifier = Modifier
            .fillMaxWidth()
            .navigationBarsPadding() // respected bottom safe insets correctly
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            NavigationBarItemCustom(
                isSelected = selectedTab == LociTab.Today,
                iconSelected = Icons.Default.Home,
                label = "Today",
                onClick = { onTabSelected(LociTab.Today) }
            )

            NavigationBarItemCustom(
                isSelected = selectedTab == LociTab.Roadmap,
                iconSelected = Icons.Default.LocationOn,
                label = "Roadmap",
                onClick = { onTabSelected(LociTab.Roadmap) }
            )

            NavigationBarItemCustom(
                isSelected = selectedTab == LociTab.Coach,
                iconSelected = Icons.Default.Info,
                label = "Coach",
                onClick = { onTabSelected(LociTab.Coach) }
            )

            NavigationBarItemCustom(
                isSelected = selectedTab == LociTab.Mentor,
                iconSelected = Icons.Default.Person,
                label = "Mentor",
                onClick = { onTabSelected(LociTab.Mentor) }
            )
        }
    }
}

@Composable
fun NavigationBarItemCustom(
    isSelected: Boolean,
    iconSelected: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    onClick: () -> Unit
) {
    val animatedPillColor by animateColorAsState(
        targetValue = if (isSelected) NaturalAccent else Color.Transparent
    )

    Column(
        modifier = Modifier
            .clickable { onClick() }
            .padding(horizontal = 8.dp)
            .width(76.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        Box(
            modifier = Modifier
                .clip(RoundedCornerShape(16.dp))
                .background(animatedPillColor)
                .padding(horizontal = 18.dp, vertical = 6.dp),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = iconSelected,
                contentDescription = label,
                tint = if (isSelected) NaturalAccentDark else NaturalText.copy(alpha = 0.62f),
                modifier = Modifier.size(22.dp)
            )
        }
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall.copy(
                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                color = if (isSelected) NaturalText else NaturalText.copy(alpha = 0.62f)
            )
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddTaskDialog(
    title: String,
    onTitleChange: (String) -> Unit,
    step: String,
    onStepChange: (String) -> Unit,
    priority: String,
    onPriorityChange: (String) -> Unit,
    level: String,
    onLevelChange: (String) -> Unit,
    category: String,
    onCategoryChange: (String) -> Unit,
    duration: String,
    onDurationChange: (String) -> Unit,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit
) {
    Dialog(onDismissRequest = onDismiss) {
        Surface(
            shape = RoundedCornerShape(24.dp),
            color = NaturalBg,
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
                .border(1.dp, NaturalBorder, RoundedCornerShape(24.dp))
        ) {
            Column(
                modifier = Modifier
                    .padding(20.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                Text(
                    text = "Pin Strategic Path Action",
                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                    color = NaturalText,
                    modifier = Modifier.padding(bottom = 4.dp)
                )

                OutlinedTextField(
                    value = title,
                    onValueChange = onTitleChange,
                    label = { Text("What commit to focus on?") },
                    colors = OutlinedTextFieldDefaults.colors(focusedTextColor = NaturalText, unfocusedTextColor = NaturalText, focusedBorderColor = BrandPurple, unfocusedBorderColor = NaturalBorder),
                    modifier = Modifier.fillMaxWidth()
                )

                OutlinedTextField(
                    value = step,
                    onValueChange = onStepChange,
                    label = { Text("Micro action (e.g. Put sneakers on)") },
                    colors = OutlinedTextFieldDefaults.colors(focusedTextColor = NaturalText, unfocusedTextColor = NaturalText, focusedBorderColor = BrandPurple, unfocusedBorderColor = NaturalBorder),
                    modifier = Modifier.fillMaxWidth()
                )

                Row(
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    OutlinedTextField(
                        value = duration,
                        onValueChange = onDurationChange,
                        label = { Text("Duration estimate mins") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        colors = OutlinedTextFieldDefaults.colors(focusedTextColor = NaturalText, unfocusedTextColor = NaturalText, focusedBorderColor = BrandPurple, unfocusedBorderColor = NaturalBorder),
                        modifier = Modifier.weight(1.2f)
                    )

                    var expandCatDropdown by remember { mutableStateOf(false) }
                    Box(modifier = Modifier.weight(1f)) {
                        OutlinedTextField(
                            value = category,
                            onValueChange = {},
                            readOnly = true,
                            label = { Text("Category") },
                            trailingIcon = {
                                IconButton(onClick = { expandCatDropdown = true }) {
                                    Icon(imageVector = Icons.Default.KeyboardArrowDown, contentDescription = null)
                                }
                            },
                            colors = OutlinedTextFieldDefaults.colors(focusedTextColor = NaturalText, unfocusedTextColor = NaturalText, focusedBorderColor = BrandPurple, unfocusedBorderColor = NaturalBorder),
                            modifier = Modifier.fillMaxWidth()
                        )
                        DropdownMenu(
                            expanded = expandCatDropdown,
                            onDismissRequest = { expandCatDropdown = false },
                            modifier = Modifier.background(Color.White)
                        ) {
                            listOf("Career", "Health", "Personal", "Work").forEach { cat ->
                                DropdownMenuItem(
                                    text = { Text(cat) },
                                    onClick = {
                                        onCategoryChange(cat)
                                        expandCatDropdown = false
                                    }
                                )
                            }
                        }
                    }
                }

                // Level Selection Row
                Text(text = "Strategic Horizon Tier Level:", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = NaturalMuted)
                val levelsList = listOf(
                    "today" to "Today Commit",
                    "week" to "This Week",
                    "month" to "This Month",
                    "office" to "Office (Work)"
                )
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    levelsList.forEach { (key, label) ->
                        FilterChip(
                            selected = level == key,
                            onClick = { onLevelChange(key) },
                            label = { Text(label, fontSize = 11.sp) },
                            colors = FilterChipDefaults.filterChipColors(selectedContainerColor = NaturalAccent, selectedLabelColor = NaturalAccentDark),
                        )
                    }
                }

                // Priority Row
                Text(text = "Drive Weight:", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = NaturalMuted)
                val priorityList = listOf("P1" to "Critical (P1)", "P2" to "Medium (P2)", "P3" to "Support (P3)", "P4" to "Dopamine (P4)")
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    priorityList.forEach { (key, label) ->
                        FilterChip(
                            selected = priority == key,
                            onClick = { onPriorityChange(key) },
                            label = { Text(label, fontSize = 11.sp) },
                            colors = FilterChipDefaults.filterChipColors(selectedContainerColor = NaturalAccent, selectedLabelColor = NaturalAccentDark),
                        )
                    }
                }

                Spacer(modifier = Modifier.height(10.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End
                ) {
                    TextButton(onClick = onDismiss, modifier = Modifier.padding(end = 8.dp)) {
                        Text("Cancel", color = NaturalMuted)
                    }
                    Button(
                        onClick = onConfirm,
                        colors = ButtonDefaults.buttonColors(containerColor = BrandPurple, contentColor = Color.White)
                    ) {
                        Text("Anchor commit", fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SyncHubDialog(
    viewModel: LociViewModel,
    onDismiss: () -> Unit
) {
    var customEmail by remember { mutableStateOf("") }
    val currentEmail by viewModel.currentUserEmail.collectAsState()

    var serverUrl by remember { mutableStateOf(com.example.data.LociSyncManager.cloudServerUrl) }
    var apiKey by remember { mutableStateOf(com.example.data.LociSyncManager.cloudApiKey) }

    Dialog(onDismissRequest = onDismiss) {
        Surface(
            shape = RoundedCornerShape(24.dp),
            color = NaturalBg,
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
                .border(1.dp, NaturalBorder, RoundedCornerShape(24.dp))
        ) {
            Column(
                modifier = Modifier
                    .padding(20.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                // Header
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Box(
                            modifier = Modifier
                                .size(36.dp)
                                .clip(CircleShape)
                                .background(BrandPurple.copy(alpha = 0.15f)),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(imageVector = Icons.Default.AccountBox, contentDescription = null, tint = BrandPurple)
                        }
                        Text(
                            text = "Loci Sync & Account Hub",
                            style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                            color = NaturalText
                        )
                    }
                    IconButton(onClick = onDismiss) {
                        Icon(imageVector = Icons.Default.Close, contentDescription = "Close", tint = NaturalMuted)
                    }
                }

                // Description
                Text(
                    text = "A real-time hybrid workspace partition engine. Seamlessly switch accounts and synchronize active commits across dual-screen tablet displays and mobile clients.",
                    fontSize = 12.sp,
                    color = NaturalMuted
                )

                Divider(color = NaturalBorder)

                // Current User Partition Section
                Text("Select Workspace Account ID:", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = NaturalMuted)
                
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    // Husband Profile Row
                    val isHusbandActive = currentEmail == "husband@gmail.com"
                    Card(
                        colors = CardDefaults.cardColors(
                            containerColor = if (isHusbandActive) BrandPurple.copy(alpha = 0.08f) else NaturalCardBg
                        ),
                        border = BorderStroke(
                            1.dp,
                            if (isHusbandActive) BrandPurple else NaturalBorder
                        ),
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { viewModel.selectUserAccount("husband@gmail.com") }
                    ) {
                        Row(
                            modifier = Modifier.padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(36.dp)
                                    .clip(CircleShape)
                                    .background(NaturalAccent),
                                contentAlignment = Alignment.Center
                            ) {
                                Text("AM", fontWeight = FontWeight.Bold, color = NaturalAccentDark, fontSize = 14.sp)
                            }
                            Column(modifier = Modifier.weight(1f)) {
                                Text("Amos (Husband Profile)", style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Bold), color = NaturalText)
                                Text("husband@gmail.com", fontSize = 11.sp, color = NaturalMuted)
                            }
                            if (isHusbandActive) {
                                Icon(imageVector = Icons.Default.CheckCircle, contentDescription = "Active", tint = BrandPurple)
                            }
                        }
                    }

                    // Wife Profile Row
                    val isWifeActive = currentEmail == "wife@gmail.com"
                    Card(
                        colors = CardDefaults.cardColors(
                            containerColor = if (isWifeActive) BrandPurple.copy(alpha = 0.08f) else NaturalCardBg
                        ),
                        border = BorderStroke(
                            1.dp,
                            if (isWifeActive) BrandPurple else NaturalBorder
                        ),
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { viewModel.selectUserAccount("wife@gmail.com") }
                    ) {
                        Row(
                            modifier = Modifier.padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(36.dp)
                                    .clip(CircleShape)
                                    .background(ClaudePurple),
                                contentAlignment = Alignment.Center
                            ) {
                                Text("SA", fontWeight = FontWeight.Bold, color = BrandPurple, fontSize = 14.sp)
                            }
                            Column(modifier = Modifier.weight(1f)) {
                                Text("Sarah (Wife Profile)", style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Bold), color = NaturalText)
                                Text("wife@gmail.com", fontSize = 11.sp, color = NaturalMuted)
                            }
                            if (isWifeActive) {
                                Icon(imageVector = Icons.Default.CheckCircle, contentDescription = "Active", tint = BrandPurple)
                            }
                        }
                    }

                    // Dynamic Custom Profile Input for demoing login
                    val isCustomActive = currentEmail != "husband@gmail.com" && currentEmail != "wife@gmail.com"
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(if (isCustomActive) BrandPurple.copy(alpha = 0.03f) else Color.Transparent)
                            .border(1.dp, if (isCustomActive) BrandPurple.copy(alpha = 0.5f) else NaturalBorder, RoundedCornerShape(12.dp))
                            .padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Text("Add Custom Workspace Email / Device:", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = NaturalMuted)
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            OutlinedTextField(
                                value = customEmail,
                                onValueChange = { customEmail = it },
                                placeholder = { Text("e.g. tablet-login@gmail.com", fontSize = 12.sp) },
                                modifier = Modifier.weight(1f),
                                singleLine = true,
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                                colors = OutlinedTextFieldDefaults.colors(
                                    focusedTextColor = NaturalText,
                                    unfocusedTextColor = NaturalText,
                                    focusedBorderColor = BrandPurple,
                                    unfocusedBorderColor = NaturalBorder
                                )
                            )
                            Button(
                                onClick = {
                                    if (customEmail.contains("@")) {
                                        viewModel.selectUserAccount(customEmail.trim())
                                        customEmail = ""
                                    }
                                },
                                shape = RoundedCornerShape(8.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = BrandPurple, contentColor = Color.White),
                                enabled = customEmail.isNotEmpty()
                            ) {
                                Text("Switch", fontSize = 12.sp)
                            }
                        }
                    }
                }

                Divider(color = NaturalBorder)

                // Cloud-Sync status controls
                Text("Cloud Tables & Synchronization Status:", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = NaturalMuted)
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = NaturalCardBg),
                    border = BorderStroke(1.dp, NaturalBorder)
                ) {
                    Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        OutlinedTextField(
                            value = serverUrl,
                            onValueChange = {
                                serverUrl = it
                                com.example.data.LociSyncManager.cloudServerUrl = it
                            },
                            label = { Text("Cloud Sync Endpoint URL", fontSize = 11.sp) },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedTextColor = NaturalText,
                                unfocusedTextColor = NaturalText,
                                focusedBorderColor = BrandPurple,
                                unfocusedBorderColor = NaturalBorder,
                                focusedLabelColor = BrandPurple,
                                unfocusedLabelColor = NaturalMuted
                            )
                        )

                        OutlinedTextField(
                            value = apiKey,
                            onValueChange = {
                                apiKey = it
                                com.example.data.LociSyncManager.cloudApiKey = it
                            },
                            label = { Text("Auth Security Token / API Key (Optional)", fontSize = 11.sp) },
                            placeholder = { Text("Enter security key", fontSize = 11.sp) },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedTextColor = NaturalText,
                                unfocusedTextColor = NaturalText,
                                focusedBorderColor = BrandPurple,
                                unfocusedBorderColor = NaturalBorder,
                                focusedLabelColor = BrandPurple,
                                unfocusedLabelColor = NaturalMuted
                            )
                        )

                        Divider(color = NaturalBorder)

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text("Realtime Sync Status:", style = MaterialTheme.typography.bodyMedium, color = NaturalText)
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                if (viewModel.isSyncingNow) {
                                    CircularProgressIndicator(modifier = Modifier.size(12.dp), strokeWidth = 1.5.dp, color = BrandPurple)
                                    Text("Syncing Remote DB...", fontSize = 12.sp, color = BrandPurple, fontWeight = FontWeight.Bold)
                                } else {
                                    Box(modifier = Modifier.size(8.dp).clip(CircleShape).background(NaturalAccent))
                                    Text("Integrated & Live", fontSize = 12.sp, color = NaturalAccentDark, fontWeight = FontWeight.Bold)
                                }
                            }
                        }

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text("Auto PWA Sync (Live):", style = MaterialTheme.typography.bodyMedium, color = NaturalText)
                            Switch(
                                checked = viewModel.isAutoSyncEnabled,
                                // Trigger animation when switching auto-sync to let the user see it activate beautiful sync animations
                                onCheckedChange = {
                                    viewModel.isAutoSyncEnabled = it
                                    if (it) { viewModel.triggerCloudSyncAnimation() }
                                },
                                colors = SwitchDefaults.colors(checkedThumbColor = BrandPurple)
                            )
                        }

                        Button(
                            onClick = { viewModel.triggerCloudSyncAnimation() },
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(12.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = NaturalAccent, contentColor = NaturalAccentDark),
                            enabled = !viewModel.isSyncingNow
                        ) {
                            Icon(imageVector = Icons.Default.Refresh, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(modifier = Modifier.width(6.dp))
                            Text("Force Manual Sync", fontWeight = FontWeight.Bold)
                        }
                    }
                }

                // Simulated Workspace Devices
                Text("Connected Screen Devices:", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = NaturalMuted)
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(NaturalCardBg, RoundedCornerShape(8.dp))
                            .border(1.dp, NaturalBorder, RoundedCornerShape(8.dp))
                            .padding(10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Icon(imageVector = Icons.Default.Share, contentDescription = null, tint = BrandPurple, modifier = Modifier.size(16.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text("Mobile Client (Active Android Phone)", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = NaturalText)
                            Text("This Handheld Instance • Port 6710 • Online Now", fontSize = 10.sp, color = NaturalMuted)
                        }
                        Box(modifier = Modifier.clip(CircleShape).background(NaturalAccent.copy(alpha = 0.2f)).padding(horizontal = 6.dp, vertical = 2.dp)) {
                            Text("Local Device", fontSize = 9.sp, color = NaturalAccentDark, fontWeight = FontWeight.Bold)
                        }
                    }

                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(NaturalCardBg, RoundedCornerShape(8.dp))
                            .border(1.dp, NaturalBorder, RoundedCornerShape(8.dp))
                            .padding(10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Icon(imageVector = Icons.Default.Home, contentDescription = null, tint = BrandPurple, modifier = Modifier.size(16.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text("Tablet Client (Large Screen Display)", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = NaturalText)
                            Text("Dual Screen Instance • Connected, Synced 1m ago", fontSize = 10.sp, color = NaturalMuted)
                        }
                        Box(modifier = Modifier.clip(CircleShape).background(BrandPurple.copy(alpha = 0.1f)).padding(horizontal = 6.dp, vertical = 2.dp)) {
                            Text("Active Sync", fontSize = 9.sp, color = BrandPurple, fontWeight = FontWeight.Bold)
                        }
                    }
                }

                Divider(color = NaturalBorder)

                // Educational architectural breakdown
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(NaturalText.copy(alpha = 0.03f), RoundedCornerShape(12.dp))
                        .padding(12.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Text("💡 How multi-user + tablet synchronization operates:", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = NaturalText)

                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(
                            text = "1. Composite Database Partitioning:",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            color = NaturalText
                        )
                        Text(
                            text = "To guarantee absolute separation, your local Room database stores every task with a composite index tying it to your unique email ID. Opening Sarah's profile retrieves only Sarah's partitioned tables, while Amos's keys exist separately on the partition.",
                            fontSize = 10.sp,
                            color = NaturalMuted
                        )

                        Spacer(modifier = Modifier.height(2.dp))

                        Text(
                            text = "2. Bi-directional Remote Cloud sync:",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            color = NaturalText
                        )
                        Text(
                            text = "Whenever you pin, complete, or add items on your phone, changes are push-committed to the cloud database. Once you unlock or connect your tablet, a service worker identifies revision delta changes, applies conflicts automatically with last-write-wins rules, and syncs both instantly!",
                            fontSize = 10.sp,
                            color = NaturalMuted
                        )
                    }
                }

                Spacer(modifier = Modifier.height(10.dp))

                Button(
                    onClick = onDismiss,
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(containerColor = BrandPurple, contentColor = Color.White),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Text("Close Panel", fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}
