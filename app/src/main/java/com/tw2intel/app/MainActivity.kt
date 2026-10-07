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

    private val touchMouseBridge = """
        (function() {
            if (window.__tw2TouchMouseInstalled) return;
            window.__tw2TouchMouseInstalled = true;

            let startX = 0;
            let startY = 0;
            let lastX = 0;
            let lastY = 0;
            let dragging = false;
            let target = null;

            const DRAG_THRESHOLD = 8;

            function mouse(type, x, y, element) {

                if (!element) {
                    element = document.elementFromPoint(x, y);
                }

                if (!element) return;

                const event = new MouseEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    clientX: x,
                    clientY: y,
                    screenX: x,
                    screenY: y,
                    button: 0,
                    buttons: type === "mouseup" ? 0 : 1
                });

                element.dispatchEvent(event);
            }

            document.addEventListener("touchstart", function(e) {

                if (e.touches.length !== 1) return;

                const t = e.touches[0];

                startX = t.clientX;
                startY = t.clientY;

                lastX = startX;
                lastY = startY;

                dragging = false;

                target = document.elementFromPoint(
                    startX,
                    startY
                );

            }, true);


            document.addEventListener("touchmove", function(e) {

                if (e.touches.length !== 1) return;

                const t = e.touches[0];

                const dx = t.clientX - startX;
                const dy = t.clientY - startY;

                if (
                    !dragging &&
                    Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD
                ) {

                    dragging = true;

                    mouse(
                        "mousedown",
                        startX,
                        startY,
                        target
                    );
                }

                if (dragging) {

                    e.preventDefault();

                    lastX = t.clientX;
                    lastY = t.clientY;

                    mouse(
                        "mousemove",
                        lastX,
                        lastY,
                        target
                    );
                }

            }, {
                capture: true,
                passive: false
            });


            document.addEventListener("touchend", function(e) {

                if (dragging) {

                    e.preventDefault();

                    mouse(
                        "mouseup",
                        lastX,
                        lastY,
                        target
                    );
                }

                dragging = false;
                target = null;

            }, {
                capture: true,
                passive: false
            });


            document.addEventListener("touchcancel", function() {

                if (dragging) {

                    mouse(
                        "mouseup",
                        lastX,
                        lastY,
                        target
                    );
                }

                dragging = false;
                target = null;

            }, true);

        })();
    """.trimIndent()


    /*
     * TW2 uses a desktop-sized page.
     *
     * This changes the viewport so WebView scales the
     * desktop game to the actual width of the phone.
     */
    private val viewportFix = """
        (function() {

            function fixViewport() {

                let viewport =
                    document.querySelector(
                        'meta[name="viewport"]'
                    );

                if (!viewport) {

                    viewport =
                        document.createElement("meta");

                    viewport.name = "viewport";

                    document.head.appendChild(viewport);
                }

                viewport.setAttribute(
                    "content",
                    "width=device-width," +
                    "initial-scale=1.0," +
                    "minimum-scale=0.25," +
                    "maximum-scale=3.0," +
                    "user-scalable=yes"
                );

                document.documentElement.style.maxWidth = "100vw";
                document.documentElement.style.overflowX = "hidden";

                document.body.style.maxWidth = "100vw";
                document.body.style.overflowX = "hidden";
            }

            fixViewport();

            setTimeout(fixViewport, 500);
            setTimeout(fixViewport, 1500);
            setTimeout(fixViewport, 3000);

        })();
    """.trimIndent()


    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {

        super.onCreate(savedInstanceState)

        webView = WebView(this)

        setContentView(webView)


        CookieManager.getInstance().apply {

            setAcceptCookie(true)

            setAcceptThirdPartyCookies(
                webView,
                true
            )
        }


        webView.settings.apply {

            javaScriptEnabled = true

            domStorageEnabled = true

            databaseEnabled = true

            cacheMode =
                WebSettings.LOAD_DEFAULT

            mediaPlaybackRequiresUserGesture =
                false


            allowFileAccess = false

            allowContentAccess = false


            /*
             * Important:
             *
             * TW2 still thinks this is a desktop browser,
             * but WebView is allowed to fit that desktop
             * page into the available phone width.
             */
            useWideViewPort = true

            loadWithOverviewMode = true


            builtInZoomControls = true

            displayZoomControls = false

            setSupportZoom(true)


            userAgentString =
                "Mozilla/5.0 " +
                "(Windows NT 10.0; Win64; x64) " +
                "AppleWebKit/537.36 " +
                "(KHTML, like Gecko) " +
                "Chrome/140.0.0.0 " +
                "Safari/537.36"
        }


        webView.webChromeClient =
            WebChromeClient()


        webView.webViewClient =
            object : WebViewClient() {


                override fun shouldOverrideUrlLoading(
                    view: WebView?,
                    request: WebResourceRequest?
                ): Boolean {

                    val url =
                        request?.url?.toString()
                            ?: return false


                    if (
                        url.startsWith("intent://") ||
                        url.startsWith("market://") ||
                        url.contains(
                            "play.google.com/store/apps/details"
                        )
                    ) {

                        return true
                    }


                    return false
                }


                @Deprecated("Deprecated in Java")
                override fun shouldOverrideUrlLoading(
                    view: WebView?,
                    url: String?
                ): Boolean {

                    if (
                        url != null &&
                        (
                            url.startsWith("intent://") ||
                            url.startsWith("market://") ||
                            url.contains(
                                "play.google.com/store/apps/details"
                            )
                        )
                    ) {

                        return true
                    }


                    return false
                }


                override fun onPageFinished(
                    view: WebView?,
                    url: String?
                ) {

                    super.onPageFinished(
                        view,
                        url
                    )


                    if (
                        url?.contains(
                            "tribalwars2.com"
                        ) == true
                    ) {

                        /*
                         * First fix the desktop viewport.
                         */
                        view?.evaluateJavascript(
                            viewportFix,
                            null
                        )


                        /*
                         * Then install our working
                         * touchscreen -> mouse bridge.
                         */
                        view?.evaluateJavascript(
                            touchMouseBridge,
                            null
                        )
                    }
                }
            }


        if (savedInstanceState == null) {

            webView.loadUrl(
                "https://en.tribalwars2.com/"
            )

        } else {

            webView.restoreState(
                savedInstanceState
            )
        }
    }


    override fun onSaveInstanceState(
        outState: Bundle
    ) {

        webView.saveState(
            outState
        )

        super.onSaveInstanceState(
            outState
        )
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
