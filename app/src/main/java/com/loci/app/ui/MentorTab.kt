package com.loci.app.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.loci.app.data.*
import com.loci.app.ui.theme.*

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

        // Interactive AI Chat Mentor Section
        Card(
            colors = CardDefaults.cardColors(containerColor = Color.White),
            shape = RoundedCornerShape(24.dp),
            border = BorderStroke(1.dp, NaturalBorder),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(
                modifier = Modifier.padding(18.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Text(
                    text = "Chat with AI Mentor (${config.mentorName})",
                    style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Bold, color = NaturalText)
                )

                Text(
                    text = "Receive advice tailored directly to your current ADHD focus goal and energy levels.",
                    fontSize = 11.sp,
                    color = NaturalMuted,
                    lineHeight = 16.sp
                )

                // Render Chat Messages
                if (viewModel.chatHistory.isNotEmpty()) {
                    Column(
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(NaturalBg, RoundedCornerShape(12.dp))
                            .border(1.dp, NaturalBorder, RoundedCornerShape(12.dp))
                            .padding(10.dp)
                            .heightIn(max = 240.dp)
                            .verticalScroll(rememberScrollState())
                    ) {
                        viewModel.chatHistory.forEach { (msg, isUser) ->
                            Column(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalAlignment = if (isUser) Alignment.End else Alignment.Start
                            ) {
                                Box(
                                    modifier = Modifier
                                        .clip(
                                            RoundedCornerShape(
                                                topStart = 12.dp,
                                                topEnd = 12.dp,
                                                bottomStart = if (isUser) 12.dp else 0.dp,
                                                bottomEnd = if (isUser) 0.dp else 12.dp
                                            )
                                        )
                                        .background(if (isUser) BrandPurple else ClaudePurple)
                                        .padding(10.dp)
                                        .widthIn(max = 220.dp)
                                ) {
                                    Text(
                                        text = msg,
                                        fontSize = 12.sp,
                                        color = if (isUser) Color.White else NaturalText
                                    )
                                }
                                Text(
                                    text = if (isUser) "You" else config.mentorName,
                                    fontSize = 9.sp,
                                    color = NaturalMuted,
                                    modifier = Modifier.padding(horizontal = 4.dp, vertical = 2.dp)
                                )
                            }
                        }
                    }
                }

                // Chat Input box and Send action button
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    OutlinedTextField(
                        value = viewModel.chatInputText,
                        onValueChange = { viewModel.chatInputText = it },
                        placeholder = { Text("Ask anything...", fontSize = 12.sp) },
                        modifier = Modifier.weight(1f),
                        singleLine = true,
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedTextColor = NaturalText,
                            unfocusedTextColor = NaturalText,
                            focusedBorderColor = BrandPurple,
                            unfocusedBorderColor = NaturalBorder
                        )
                    )

                    if (viewModel.isChatLoading) {
                        CircularProgressIndicator(
                            color = BrandPurple,
                            modifier = Modifier.size(24.dp),
                            strokeWidth = 2.5.dp
                        )
                    } else {
                        Button(
                            onClick = { viewModel.sendChatMessage() },
                            colors = ButtonDefaults.buttonColors(containerColor = BrandPurple, contentColor = Color.White),
                            shape = RoundedCornerShape(10.dp),
                            enabled = viewModel.chatInputText.isNotBlank()
                        ) {
                            Text("Send", fontSize = 12.sp)
                        }
                    }
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
