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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.loci.app.data.*
import com.loci.app.ui.theme.*
import java.text.SimpleDateFormat
import java.util.*

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

            val gridData = remember(contributions) {
                val sdf = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
                List(16) { col ->
                    List(7) { row ->
                        val computedDaysAgo = (15 - col) * 7 + (6 - row)
                        val cal = Calendar.getInstance()
                        cal.add(Calendar.DAY_OF_YEAR, -computedDaysAgo)
                        val dateStr = sdf.format(cal.time)

                        val matchingCount = contributions.firstOrNull { it.dateString == dateStr }?.count ?: 0
                        val color = when {
                            matchingCount >= 4 -> BrandPurple
                            matchingCount == 3 -> ProgressGreyGreen
                            matchingCount == 2 -> NaturalAccent
                            matchingCount == 1 -> ClaudePurple
                            else -> NaturalBg
                        }
                        Triple(color, dateStr, matchingCount)
                    }
                }
            }

            // Grid contribution map visualization layout (7 rows by 16 columns representation)
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                // Generate simulated grid days
                for (col in 0..15) {
                    Column(
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        for (row in 0..6) {
                            val (gridColor, dateStr, matchingCount) = gridData[col][row]

                            Box(
                                modifier = Modifier
                                    .size(14.dp)
                                    .clip(RoundedCornerShape(3.dp))
                                    .background(gridColor)
                                    .border(0.5.dp, NaturalBorder.copy(alpha = 0.5f), RoundedCornerShape(3.dp))
                                    .semantics {
                                        contentDescription = "$dateStr: $matchingCount tasks"
                                    }
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
