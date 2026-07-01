package com.loci.app.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.loci.app.data.*
import com.loci.app.ui.theme.*
import java.util.*

@Composable
fun LociTodayTabContent(
    config: LociConfig,
    tasks: List<Task>,
    viewModel: LociViewModel,
    contributions: List<ContributionDay>,
    checklistItems: List<TaskChecklistItem>
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
                        checklistItems = checklistItems.filter { it.taskUuid == task.uuid },
                        onChecklistItemToggle = viewModel::toggleChecklistItem,
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
                        "Dump anything — 'call dentist thursday', 'fix cv this week', 'gym today'...",
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
