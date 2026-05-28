package com.loci.app.ui

import androidx.compose.animation.*
import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.loci.app.data.*
import com.loci.app.ui.theme.*

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
        targetValue = if (isSelected) NaturalAccent else Color.Transparent,
        label = "pill_color"
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
