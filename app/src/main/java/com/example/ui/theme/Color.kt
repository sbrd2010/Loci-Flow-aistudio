package com.example.ui.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf

val Purple80 = Color(0xFFD0BCFF)
val PurpleGrey80 = Color(0xFFCCC2DC)
val Pink80 = Color(0xFFEFB8C8)

val Purple40 = Color(0xFF6650a4)
val PurpleGrey40 = Color(0xFF625b71)
val Pink40 = Color(0xFF7D5260)

// Standard progress indicators
val ProgressGreyGreen = Color(0xFFBBCABB)
val ProgressDarkGrey = Color(0xFF8A928A)

// Premium Matte Theme System Configuration
enum class LociMatteThemeConfig(val displayName: String) {
    WarmSand("Warm Sand"),
    CharcoalSlate("Charcoal Slate"),
    NordicForest("Nordic Forest"),
    TokyoConcrete("Tokyo Concrete")
}

object LociThemeManager {
    var activeTheme by mutableStateOf(LociMatteThemeConfig.WarmSand)
}

// Dynamically evaluated colors using package getters backed by Compose State for instant recomposition
val NaturalBg: Color
    get() = when (LociThemeManager.activeTheme) {
        LociMatteThemeConfig.WarmSand -> Color(0xFFFDF8F6)
        LociMatteThemeConfig.CharcoalSlate -> Color(0xFF121416)
        LociMatteThemeConfig.NordicForest -> Color(0xFFF4F6F0)
        LociMatteThemeConfig.TokyoConcrete -> Color(0xFFF6F6F7)
    }

val NaturalText: Color
    get() = when (LociThemeManager.activeTheme) {
        LociMatteThemeConfig.WarmSand -> Color(0xFF1F1B16)
        LociMatteThemeConfig.CharcoalSlate -> Color(0xFFE3E2E6)
        LociMatteThemeConfig.NordicForest -> Color(0xFF1A261D)
        LociMatteThemeConfig.TokyoConcrete -> Color(0xFF18191B)
    }

val NaturalMuted: Color
    get() = when (LociThemeManager.activeTheme) {
        LociMatteThemeConfig.WarmSand -> Color(0xFF4D4639)
        LociMatteThemeConfig.CharcoalSlate -> Color(0xFF909094)
        LociMatteThemeConfig.NordicForest -> Color(0xFF4F5E52)
        LociMatteThemeConfig.TokyoConcrete -> Color(0xFF5F6166)
    }

val NaturalAccent: Color
    get() = when (LociThemeManager.activeTheme) {
        LociMatteThemeConfig.WarmSand -> Color(0xFFD7E3BD)
        LociMatteThemeConfig.CharcoalSlate -> Color(0xFFBBCABB)
        LociMatteThemeConfig.NordicForest -> Color(0xFFC2D8C2)
        LociMatteThemeConfig.TokyoConcrete -> Color(0xFF7F8287)
    }

val NaturalAccentDark: Color
    get() = when (LociThemeManager.activeTheme) {
        LociMatteThemeConfig.WarmSand -> Color(0xFF191D08)
        LociMatteThemeConfig.CharcoalSlate -> Color(0xFF131D14)
        LociMatteThemeConfig.NordicForest -> Color(0xFF131D14)
        LociMatteThemeConfig.TokyoConcrete -> Color(0xFF1B1C1E)
    }

val NaturalCardBg: Color
    get() = when (LociThemeManager.activeTheme) {
        LociMatteThemeConfig.WarmSand -> Color(0xFFF3EFEA)
        LociMatteThemeConfig.CharcoalSlate -> Color(0xFF1E2124)
        LociMatteThemeConfig.NordicForest -> Color(0xFFE5E8DD)
        LociMatteThemeConfig.TokyoConcrete -> Color(0xFFECECEE)
    }

val NaturalBorder: Color
    get() = when (LociThemeManager.activeTheme) {
        LociMatteThemeConfig.WarmSand -> Color(0xFFE8E0D5)
        LociMatteThemeConfig.CharcoalSlate -> Color(0xFF2D3135)
        LociMatteThemeConfig.NordicForest -> Color(0xFFD4D8CA)
        LociMatteThemeConfig.TokyoConcrete -> Color(0xFFDCDCE0)
    }

val BrandPurple: Color
    get() = when (LociThemeManager.activeTheme) {
        LociMatteThemeConfig.WarmSand -> Color(0xFF6750A4)
        LociMatteThemeConfig.CharcoalSlate -> Color(0xFFB09FFF)
        LociMatteThemeConfig.NordicForest -> Color(0xFF2B5B3E)
        LociMatteThemeConfig.TokyoConcrete -> Color(0xFF252627)
    }

val ClaudePurple: Color
    get() = when (LociThemeManager.activeTheme) {
        LociMatteThemeConfig.WarmSand -> Color(0xFFE8DEF8)
        LociMatteThemeConfig.CharcoalSlate -> Color(0xFF292534)
        LociMatteThemeConfig.NordicForest -> Color(0xFFE3EBDF)
        LociMatteThemeConfig.TokyoConcrete -> Color(0xFFE3E4E6)
    }

val ClaudePurpleText: Color
    get() = when (LociThemeManager.activeTheme) {
        LociMatteThemeConfig.WarmSand -> Color(0xFF49454F)
        LociMatteThemeConfig.CharcoalSlate -> Color(0xFFD0C3E5)
        LociMatteThemeConfig.NordicForest -> Color(0xFF2D4B34)
        LociMatteThemeConfig.TokyoConcrete -> Color(0xFF424448)
    }

val ChatGPTBlue: Color
    get() = when (LociThemeManager.activeTheme) {
        LociMatteThemeConfig.WarmSand -> Color(0xFFD1E4FF)
        LociMatteThemeConfig.CharcoalSlate -> Color(0xFF2D3748)
        LociMatteThemeConfig.NordicForest -> Color(0xFFC7DEC8)
        LociMatteThemeConfig.TokyoConcrete -> Color(0xFFDBDDE1)
    }
