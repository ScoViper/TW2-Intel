
package com.tw2intel.app

import android.app.Activity
import android.os.Bundle
import android.widget.TextView

class MainActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val text = TextView(this).apply {
            text = "TW2 Intel\n\nAndroid app is running successfully."
            textSize = 22f
            gravity = android.view.Gravity.CENTER
        }

        setContentView(text)
    }
}
