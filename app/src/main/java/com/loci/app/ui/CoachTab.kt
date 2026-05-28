package com.loci.app.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.loci.app.data.*
import com.loci.app.ui.theme.*

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

        // AI Weekly Horizon Review Card
        Card(
            colors = CardDefaults.cardColors(containerColor = Color.White),
            shape = RoundedCornerShape(20.dp),
            border = BorderStroke(1.dp, NaturalBorder),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(
                modifier = Modifier.padding(18.dp)
            ) {
                Text(
                    text = "AI Weekly Horizon Review",
                    style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Bold, color = NaturalText)
                )
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    text = "Let your AI mentor scan your backlog and tell you what to pull into today.",
                    fontSize = 11.sp,
                    color = NaturalMuted,
                    lineHeight = 16.sp
                )

                Spacer(modifier = Modifier.height(12.dp))

                if (viewModel.isWeeklyReviewLoading) {
                    Box(
                        modifier = Modifier.fillMaxWidth().padding(8.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        CircularProgressIndicator(color = BrandPurple)
                    }
                } else {
                    Button(
                        onClick = { viewModel.runWeeklyAiReview() },
                        colors = ButtonDefaults.buttonColors(containerColor = BrandPurple, contentColor = Color.White),
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("Run AI Review", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                    }
                }

                if (viewModel.weeklyReviewSuggestion.isNotEmpty()) {
                    Spacer(modifier = Modifier.height(12.dp))
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(NaturalBg)
                            .border(1.dp, NaturalBorder, RoundedCornerShape(12.dp))
                            .padding(12.dp)
                    ) {
                        Text(
                            text = viewModel.weeklyReviewSuggestion,
                            style = MaterialTheme.typography.bodySmall.copy(
                                color = NaturalText,
                                lineHeight = 18.sp
                            )
                        )
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(80.dp))
    }
}
