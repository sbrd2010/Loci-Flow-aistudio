package com.loci.app.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

@Composable
fun MyApplicationTheme(
  darkTheme: Boolean = isSystemInDarkTheme(),
  dynamicColor: Boolean = false,
  content: @Composable () -> Unit,
) {
  // Respect the user's manual matte theme selection: CharcoalSlate is a deep luxurious dark matte theme.
  val isDark = LociThemeManager.activeTheme == LociMatteThemeConfig.CharcoalSlate
  val colorScheme = if (isDark) {
    darkColorScheme(
      primary = BrandPurple,
      secondary = NaturalAccent,
      tertiary = ClaudePurple,
      background = NaturalBg,
      surface = NaturalCardBg,
      onPrimary = Color.Black,
      onSecondary = NaturalAccentDark,
      onBackground = NaturalText,
      onSurface = NaturalText,
      outline = NaturalBorder
    )
  } else {
    lightColorScheme(
      primary = BrandPurple,
      secondary = NaturalAccent,
      tertiary = ClaudePurple,
      background = NaturalBg,
      surface = NaturalCardBg,
      onPrimary = Color.White,
      onSecondary = NaturalAccentDark,
      onTertiary = ClaudePurpleText,
      onBackground = NaturalText,
      onSurface = NaturalText,
      outline = NaturalBorder
    )
  }

  MaterialTheme(colorScheme = colorScheme, typography = Typography, content = content)
}
