package com.loci.app.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import com.loci.app.data.*
import com.loci.app.ui.theme.*

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
    var currentStep by remember { mutableStateOf(1) }
    var userName by remember { mutableStateOf("") }
    var selectedChallenge by remember { mutableStateOf("starting") }
    var selectedMentor by remember { mutableStateOf("Marcus Aurelius") }

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
                modifier = Modifier
                    .padding(24.dp)
                    .verticalScroll(rememberScrollState()),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                // Progress Indicator
                LinearProgressIndicator(
                    progress = { currentStep.toFloat() / 4f },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(6.dp)
                        .clip(RoundedCornerShape(3.dp)),
                    color = BrandPurple,
                    trackColor = NaturalBorder
                )

                Text(
                    text = "Step $currentStep / 4",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    color = BrandPurple
                )

                when (currentStep) {
                    1 -> {
                        Icon(
                            imageVector = Icons.Default.Favorite,
                            contentDescription = null,
                            tint = BrandPurple,
                            modifier = Modifier.size(40.dp)
                        )

                        Text(
                            text = "Welcome to Loci",
                            style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold),
                            color = NaturalText,
                            textAlign = TextAlign.Center
                        )

                        Text(
                            text = "A focus app built for ADHD brains.",
                            style = MaterialTheme.typography.bodyMedium.copy(color = NaturalMuted),
                            textAlign = TextAlign.Center
                        )

                        OutlinedTextField(
                            value = userName,
                            onValueChange = { userName = it },
                            label = { Text("What should Loci call you?") },
                            singleLine = true,
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedTextColor = NaturalText,
                                unfocusedTextColor = NaturalText,
                                focusedBorderColor = BrandPurple,
                                unfocusedBorderColor = NaturalBorder
                            ),
                            modifier = Modifier.fillMaxWidth()
                        )

                        Spacer(modifier = Modifier.height(8.dp))

                        Button(
                            onClick = { currentStep = 2 },
                            enabled = userName.isNotBlank(),
                            colors = ButtonDefaults.buttonColors(containerColor = BrandPurple, contentColor = Color.White),
                            shape = RoundedCornerShape(12.dp),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text("Next", fontWeight = FontWeight.Bold)
                        }
                    }
                    2 -> {
                        Text(
                            text = "What's your biggest challenge?",
                            style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold),
                            color = NaturalText,
                            textAlign = TextAlign.Center
                        )

                        val challenges = listOf(
                            "starting" to "Starting Inertia (Getting started on tasks)",
                            "focusing" to "Focus & Distractions (Staying focused once)",
                            "execution" to "Consistent Execution (Following through)",
                            "tracking" to "Calendar Overload (Keeping track of time)"
                        )

                        Column(
                            modifier = Modifier.fillMaxWidth(),
                            verticalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            challenges.forEach { (key, label) ->
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clip(RoundedCornerShape(12.dp))
                                        .background(if (selectedChallenge == key) BrandPurple.copy(alpha = 0.08f) else Color.White)
                                        .border(1.dp, if (selectedChallenge == key) BrandPurple else NaturalBorder, RoundedCornerShape(12.dp))
                                        .clickable { selectedChallenge = key }
                                        .padding(horizontal = 14.dp, vertical = 12.dp)
                                ) {
                                    RadioButton(
                                        selected = selectedChallenge == key,
                                        onClick = { selectedChallenge = key },
                                        colors = RadioButtonDefaults.colors(selectedColor = BrandPurple)
                                    )
                                    Spacer(modifier = Modifier.width(8.dp))
                                    Text(text = label, style = MaterialTheme.typography.bodyMedium.copy(color = NaturalText))
                                }
                            }
                        }

                        Spacer(modifier = Modifier.height(8.dp))

                        Row(
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            OutlinedButton(
                                onClick = { currentStep = 1 },
                                shape = RoundedCornerShape(12.dp),
                                modifier = Modifier.weight(1f)
                            ) {
                                Text("Back", color = BrandPurple)
                            }
                            Button(
                                onClick = { currentStep = 3 },
                                colors = ButtonDefaults.buttonColors(containerColor = BrandPurple, contentColor = Color.White),
                                shape = RoundedCornerShape(12.dp),
                                modifier = Modifier.weight(1f)
                            ) {
                                Text("Next", fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                    3 -> {
                        Text(
                            text = "Choose your mentor",
                            style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold),
                            color = NaturalText,
                            textAlign = TextAlign.Center
                        )

                        val mentors = listOf("Marcus Aurelius", "Yoda", "Seneca", "David Goggins")

                        Column(
                            modifier = Modifier.fillMaxWidth(),
                            verticalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            mentors.forEach { name ->
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clip(RoundedCornerShape(12.dp))
                                        .background(if (selectedMentor == name) BrandPurple.copy(alpha = 0.08f) else Color.White)
                                        .border(1.dp, if (selectedMentor == name) BrandPurple else NaturalBorder, RoundedCornerShape(12.dp))
                                        .clickable { selectedMentor = name }
                                        .padding(horizontal = 14.dp, vertical = 12.dp)
                                ) {
                                    RadioButton(
                                        selected = selectedMentor == name,
                                        onClick = { selectedMentor = name },
                                        colors = RadioButtonDefaults.colors(selectedColor = BrandPurple)
                                    )
                                    Spacer(modifier = Modifier.width(8.dp))
                                    Text(text = name, style = MaterialTheme.typography.bodyMedium.copy(color = NaturalText))
                                }
                            }
                        }

                        Spacer(modifier = Modifier.height(8.dp))

                        Row(
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            OutlinedButton(
                                onClick = { currentStep = 2 },
                                shape = RoundedCornerShape(12.dp),
                                modifier = Modifier.weight(1f)
                            ) {
                                Text("Back", color = BrandPurple)
                            }
                            Button(
                                onClick = { currentStep = 4 },
                                colors = ButtonDefaults.buttonColors(containerColor = BrandPurple, contentColor = Color.White),
                                shape = RoundedCornerShape(12.dp),
                                modifier = Modifier.weight(1f)
                            ) {
                                Text("Next", fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                    4 -> {
                        Text(
                            text = "You're ready, $userName",
                            style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold),
                            color = NaturalText,
                            textAlign = TextAlign.Center
                        )

                        val challengeLabel = when (selectedChallenge) {
                            "starting" -> "Getting started on tasks"
                            "focusing" -> "Staying focused once I start"
                            "execution" -> "Following through to completion"
                            else -> "Keeping track of time"
                        }

                        Card(
                            colors = CardDefaults.cardColors(containerColor = Color.White),
                            shape = RoundedCornerShape(16.dp),
                            border = BorderStroke(1.dp, NaturalBorder),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Column(
                                modifier = Modifier.padding(16.dp),
                                verticalArrangement = Arrangement.spacedBy(10.dp)
                            ) {
                                Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                                    Text("Name:", fontSize = 13.sp, color = NaturalMuted)
                                    Text(userName, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = NaturalText)
                                }
                                Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                                    Text("Primary Goal:", fontSize = 13.sp, color = NaturalMuted)
                                    Text(challengeLabel, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = NaturalText)
                                }
                                Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                                    Text("Mentor Chosen:", fontSize = 13.sp, color = NaturalMuted)
                                    Text(selectedMentor, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = NaturalText)
                                }
                            }
                        }

                        Spacer(modifier = Modifier.height(8.dp))

                        Button(
                            onClick = {
                                viewModel.updateProfileSettings(
                                    uName = userName,
                                    mName = selectedMentor,
                                    challenge = selectedChallenge,
                                    duration = 25,
                                    interval = 15,
                                    guard = true
                                )
                                viewModel.finishOnboarding()
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = NaturalAccent, contentColor = NaturalAccentDark),
                            shape = RoundedCornerShape(12.dp),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text("Start My Focus Journey", fontWeight = FontWeight.Bold)
                        }
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

    var serverUrl by remember { mutableStateOf(com.loci.app.data.LociSyncManager.cloudServerUrl) }
    var apiKey by remember { mutableStateOf(com.loci.app.data.LociSyncManager.cloudApiKey) }

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

                HorizontalDivider(color = NaturalBorder)

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

                HorizontalDivider(color = NaturalBorder)

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
                                com.loci.app.data.LociSyncManager.cloudServerUrl = it
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
                                com.loci.app.data.LociSyncManager.cloudApiKey = it
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

                        HorizontalDivider(color = NaturalBorder)

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

                // Real Sync Status Card
                Card(
                    colors = CardDefaults.cardColors(containerColor = NaturalCardBg),
                    border = BorderStroke(1.dp, NaturalBorder),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(
                        text = "Sync Status: This device syncs with Firebase when you complete or add tasks.\nAll your data is stored locally and backed up to the cloud automatically.",
                        fontSize = 12.sp,
                        color = NaturalMuted,
                        modifier = Modifier.padding(12.dp),
                        lineHeight = 16.sp
                    )
                }

                HorizontalDivider(color = NaturalBorder)

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
                        enabled = title.isNotBlank(),
                        colors = ButtonDefaults.buttonColors(containerColor = BrandPurple, contentColor = Color.White)
                    ) {
                        Text("Anchor commit", fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }
}
