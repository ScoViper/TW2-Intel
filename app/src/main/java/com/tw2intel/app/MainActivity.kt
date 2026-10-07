package com.tw2intel.app

import android.annotation.SuppressLint
import android.app.Activity
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient

class MainActivity : Activity() {

    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this)
        setContentView(webView)

        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, true)
        }

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            cacheMode = WebSettings.LOAD_DEFAULT
            mediaPlaybackRequiresUserGesture = false

            allowFileAccess = false
            allowContentAccess = false

            useWideViewPort = true
            loadWithOverviewMode = true

            // Make TW2 treat this as a desktop browser,
            // rather than redirecting us to the Android app.
            userAgentString =
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
                "AppleWebKit/537.36 (KHTML, like Gecko) " +
                "Chrome/140.0.0.0 Safari/537.36"
        }

        webView.webChromeClient = WebChromeClient()

        webView.webViewClient = object : WebViewClient() {

            override fun shouldOverrideUrlLoading(
                view: WebView?,
                request: WebResourceRequest?
            ): Boolean {

                val url = request?.url?.toString() ?: return false

                if (url.startsWith("intent://") ||
                    url.startsWith("market://") ||
                    url.contains("play.google.com/store/apps/details")) {
                    return true
                }

                return false
            }

            @Deprecated("Deprecated in Java")
            override fun shouldOverrideUrlLoading(
                view: WebView?,
                url: String?
            ): Boolean {

                if (url != null &&
                    (url.startsWith("intent://") ||
                     url.startsWith("market://") ||
                     url.contains("play.google.com/store/apps/details"))) {
                    return true
                }

                return false
            }
        }

        if (savedInstanceState == null) {
            webView.loadUrl("https://en.tribalwars2.com/")
        } else {
            webView.restoreState(savedInstanceState)
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        webView.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }
}
