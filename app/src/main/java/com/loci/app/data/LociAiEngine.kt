package com.loci.app.data

import com.google.ai.client.generativeai.GenerativeModel

object LociAiEngine {
    private val model by lazy {
        GenerativeModel(
            modelName = "gemini-1.5-flash",
            apiKey = com.loci.app.BuildConfig.GEMINI_API_KEY ?: ""
        )
    }

    suspend fun generate(prompt: String): String {
        return try {
            model.generateContent(prompt).text ?: ""
        } catch (e: Exception) {
            ""
        }
    }
}
