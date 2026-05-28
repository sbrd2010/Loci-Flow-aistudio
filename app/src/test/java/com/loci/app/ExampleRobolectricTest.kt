package com.loci.app

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.loci.app.data.*
import com.loci.app.ui.LociViewModel
import com.loci.app.R
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class ExampleRobolectricTest {

  @Test
  fun `read string from context`() {
    val context = ApplicationProvider.getApplicationContext<android.app.Application>()
    val appName = context.getString(R.string.app_name)
    assertEquals("Loci", appName)
  }

  @Test
  fun testViewModelAndSyncExecution() = runTest {
    val context = ApplicationProvider.getApplicationContext<android.app.Application>()
    val database = LociDatabase.getDatabase(context)
    val dao = database.lociDao()
    val repository = LociRepository(dao)
    
    // Attempt to seed
    val viewModel = LociViewModel(repository, context)
    assertNotNull(viewModel)
    
    // Call sync directly to see if any crashes occur (e.g. library, serialization, network setup)
    val result = LociSyncManager.sync(context, repository, "husband@gmail.com")
    println("Sync completed with result: $result")
    assertNotNull(result)
  }
}
