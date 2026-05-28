package com.loci.app.ui

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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.loci.app.data.*
import com.loci.app.ui.theme.*

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
