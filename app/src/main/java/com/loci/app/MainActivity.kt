package com.loci.app

import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.ui.Modifier
import androidx.lifecycle.ViewModelProvider
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.loci.app.data.LociDatabase
import com.loci.app.data.LociRepository
import com.loci.app.ui.LociScreen
import com.loci.app.ui.LociViewModel
import com.loci.app.ui.LociViewModelFactory
import com.loci.app.ui.theme.MyApplicationTheme
import java.util.concurrent.TimeUnit

class MainActivity : ComponentActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    enableEdgeToEdge()

    // Request notification permission for Android 13+ at runtime
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      if (checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
        requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 101)
      }
    }

    // Enqueue 12-hour periodic work using WorkManager to remind user
    val workRequest = PeriodicWorkRequestBuilder<FocusNagWorker>(
      12, TimeUnit.HOURS
    ).build()

    WorkManager.getInstance(this).enqueueUniquePeriodicWork(
      "loci_nag_reminder",
      ExistingPeriodicWorkPolicy.KEEP,
      workRequest
    )

    // Initialize database, repository and ViewModel
    val database = LociDatabase.getDatabase(this)
    val dao = database.lociDao()
    val repository = LociRepository(dao)
    val factory = LociViewModelFactory(repository, this.application)
    val viewModel = ViewModelProvider(this, factory)[LociViewModel::class.java]

    setContent {
      MyApplicationTheme {
        Scaffold(modifier = Modifier.fillMaxSize()) { innerPadding ->
          LociScreen(
            viewModel = viewModel,
            modifier = Modifier.padding(innerPadding)
          )
        }
      }
    }
  }
}

