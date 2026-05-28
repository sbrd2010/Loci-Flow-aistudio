package com.loci.app.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Build
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.loci.app.data.*
import com.loci.app.ui.theme.*

@OptIn(ExperimentalMaterial3Api::class)
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
