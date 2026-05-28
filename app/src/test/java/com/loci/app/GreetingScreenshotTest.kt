package com.loci.app

import android.content.Context
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.loci.app.data.LociDatabase
import com.loci.app.data.LociRepository
import com.loci.app.ui.LociScreen
import com.loci.app.ui.LociViewModel
import com.loci.app.ui.theme.MyApplicationTheme
import com.github.takahirom.roborazzi.RobolectricDeviceQualifiers
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = RobolectricDeviceQualifiers.Pixel8, sdk = [36])
class GreetingScreenshotTest {

  @get:Rule val composeTestRule = createComposeRule()

  @Test
  fun greeting_screenshot() {
    val context = ApplicationProvider.getApplicationContext<android.app.Application>()
    val database = Room.inMemoryDatabaseBuilder(context, LociDatabase::class.java)
      .allowMainThreadQueries()
      .build()
    val dao = database.lociDao()
    val repository = LociRepository(dao)
    val viewModel = LociViewModel(repository, context)

    composeTestRule.setContent {
      MyApplicationTheme {
        LociScreen(viewModel = viewModel)
      }
    }

    composeTestRule.onRoot().captureRoboImage(filePath = "src/test/screenshots/greeting.png")
    database.close()
  }
}
