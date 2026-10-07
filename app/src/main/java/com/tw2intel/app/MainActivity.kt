package com.tw2intel.app

import android.annotation.SuppressLint
import android.app.Activity
import android.content.res.Configuration
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient

class MainActivity : Activity() {

    private lateinit var webView: WebView

    /*
     * Approximate width of the TW2 desktop game interface.
     * The app calculates the scale needed to fit this width
     * onto the phone automatically.
     */
    private val tw2DesktopWidth = 1920f

    private val touchMouseBridge = """
        (function() {

            if (window.__tw2TouchMouseInstalled) return;
            window.__tw2TouchMouseInstalled = true;

            let startX = 0;
            let startY = 0;
            let lastX = 0;
            let lastY = 0;

            let dragging = false;
            let mapTouch = false;
            let target = null;

            const DRAG_THRESHOLD = 8;

            function isInsideWindow(element) {

                if (!element) return false;

                return !!element.closest(
                    [
                        ".window",
                        ".popup",
                        ".modal",
                        ".dialog",
                        ".overview",
                        ".content-border",
                        "[role='dialog']"
                    ].join(",")
                );
            }

            function isMapArea(element) {

                if (!element) return false;

                if (
                    element.closest(
                        "button, a, input, select, textarea"
                    )
                ) {
                    return false;
                }

                if (isInsideWindow(element)) {
                    return false;
                }

                const y = startY;
                const screenHeight = window.innerHeight;

                if (y < 100) {
                    return false;
                }

                if (y > screenHeight - 120) {
                    return false;
                }

                return true;
            }

            function mouse(type, x, y, element) {

                if (!element) {
                    element =
                        document.elementFromPoint(x, y);
                }

                if (!element) return;

                const event =
                    new MouseEvent(type, {

                        bubbles: true,
                        cancelable: true,
                        view: window,

                        clientX: x,
                        clientY: y,

                        screenX: x,
                        screenY: y,

                        button: 0,

                        buttons:
                            type === "mouseup"
                                ? 0
                                : 1
                    });

                element.dispatchEvent(event);
            }

            document.addEventListener(
                "touchstart",
                function(e) {

                    /*
                     * Leave two-finger gestures alone
                     * for pinch zoom.
                     */
                    if (e.touches.length !== 1) {

                        mapTouch = false;
                        dragging = false;

                        return;
                    }

                    const t = e.touches[0];

                    startX = t.clientX;
                    startY = t.clientY;

                    lastX = startX;
                    lastY = startY;

                    target =
                        document.elementFromPoint(
                            startX,
                            startY
                        );

                    dragging = false;

                    mapTouch =
                        isMapArea(target);
                },
                true
            );

            document.addEventListener(
                "touchmove",
                function(e) {

                    /*
                     * Don't interfere with normal scrolling
                     * inside TW2 windows and menus.
                     */
                    if (!mapTouch) {
                        return;
                    }

                    if (e.touches.length !== 1) {

                        mapTouch = false;
                        dragging = false;

                        return;
                    }

                    const t = e.touches[0];

                    const dx =
                        t.clientX - startX;

                    const dy =
                        t.clientY - startY;

                    if (
                        !dragging &&
                        Math.sqrt(
                            dx * dx + dy * dy
                        ) > DRAG_THRESHOLD
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
                },
                {
                    capture: true,
                    passive: false
                }
            );

            document.addEventListener(
                "touchend",
                function(e) {

                    if (
                        mapTouch &&
                        dragging
                    ) {

                        e.preventDefault();

                        mouse(
                            "mouseup",
                            lastX,
                            lastY,
                            target
                        );
                    }

                    dragging = false;
                    mapTouch = false;
                    target = null;
                },
                {
                    capture: true,
                    passive: false
                }
            );

            document.addEventListener(
                "touchcancel",
                function() {

                    if (
                        mapTouch &&
                        dragging
                    ) {

                        mouse(
                            "mouseup",
                            lastX,
                            lastY,
                            target
                        );
                    }

                    dragging = false;
                    mapTouch = false;
                    target = null;
                },
                true
            );

        })();
    """.trimIndent()


    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(
        savedInstanceState: Bundle?
    ) {

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
             * Keep TW2's desktop layout.
             */
            useWideViewPort = true

            loadWithOverviewMode = true


            /*
             * Keep pinch zoom enabled.
             */
            builtInZoomControls = true

            displayZoomControls = false

            setSupportZoom(true)


            /*
             * Desktop UA prevents TW2 from
             * redirecting to Google Play.
             */
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
                         * Keep our working touchscreen
                         * map control.
                         */
                        view?.evaluateJavascript(
                            touchMouseBridge,
                            null
                        )


                        /*
                         * Give TW2 time to finish building
                         * its interface before calculating
                         * the correct scale.
                         */
                        view?.postDelayed(
                            {
                                fitTw2ToScreen()
                            },
                            1200
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


    private fun fitTw2ToScreen() {

        val widthPixels =
            webView.width

        if (widthPixels <= 0) {
            return
        }


        /*
         * WebView width is physical pixels.
         * Convert it to density-independent width.
         */
        val density =
            resources.displayMetrics.density

        val availableWidth =
            widthPixels / density


        /*
         * Calculate percentage needed to fit
         * the 1920-wide TW2 desktop interface.
         */
        var scale =
            (
                availableWidth /
                tw2DesktopWidth *
                100f
            ).toInt()


        /*
         * Keep it within sensible limits.
         */
        scale =
            scale.coerceIn(
                25,
                100
            )


        webView.setInitialScale(
            scale
        )
    }


    /*
     * Your manifest already tells Android that
     * this Activity handles orientation/screen-size
     * changes itself.
     */
    override fun onConfigurationChanged(
        newConfig: Configuration
    ) {

        super.onConfigurationChanged(
            newConfig
        )


        /*
         * Wait until Android has resized the WebView,
         * then calculate the fit again.
         */
        webView.postDelayed(
            {
                fitTw2ToScreen()
            },
            400
        )
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
