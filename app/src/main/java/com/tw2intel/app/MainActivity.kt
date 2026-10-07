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

    /*
     * Converts single-finger movement over the TW2 map
     * into mouse movement.
     *
     * KEEP THIS - this is what makes map dragging work.
     */
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
                const h = window.innerHeight;

                /*
                 * Don't intercept the top and bottom
                 * TW2 interface bars.
                 */
                if (y < 100) return false;
                if (y > h - 120) return false;

                return true;
            }

            function mouse(type, x, y, element) {

                if (!element) {
                    element = document.elementFromPoint(x, y);
                }

                if (!element) return;

                const event =
                    new MouseEvent(
                        type,
                        {
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
                        }
                    );

                element.dispatchEvent(event);
            }

            document.addEventListener(
                "touchstart",
                function(e) {

                    /*
                     * Two fingers belong to WebView
                     * pinch zoom. Don't interfere.
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

                    if (!mapTouch) return;

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


    /*
     * Keep the wide viewport and full manual
     * pinch-zoom range that is working now.
     */
    private val viewportFix = """
        (function() {

            function applyTW2Viewport() {

                var viewport =
                    document.querySelector(
                        'meta[name="viewport"]'
                    );

                if (!viewport) {

                    viewport =
                        document.createElement(
                            "meta"
                        );

                    viewport.name =
                        "viewport";

                    document.head.appendChild(
                        viewport
                    );
                }

                viewport.setAttribute(
                    "content",
                    "width=1920, " +
                    "initial-scale=1.0, " +
                    "minimum-scale=0.1, " +
                    "maximum-scale=5.0, " +
                    "user-scalable=yes"
                );
            }

            applyTW2Viewport();

            setTimeout(
                applyTW2Viewport,
                500
            );

            setTimeout(
                applyTW2Viewport,
                1500
            );

            setTimeout(
                applyTW2Viewport,
                3000
            );

        })();
    """.trimIndent()


    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(
        savedInstanceState: Bundle?
    ) {

        super.onCreate(
            savedInstanceState
        );

        webView = WebView(this);

        setContentView(
            webView
        );


        /*
         * Keep TW2 login/session cookies.
         */
        CookieManager
            .getInstance()
            .apply {

                setAcceptCookie(
                    true
                );

                setAcceptThirdPartyCookies(
                    webView,
                    true
                );
            }


        webView.settings.apply {

            javaScriptEnabled = true;

            domStorageEnabled = true;

            databaseEnabled = true;

            cacheMode =
                WebSettings.LOAD_DEFAULT;

            mediaPlaybackRequiresUserGesture =
                false;


            allowFileAccess = false;

            allowContentAccess = false;


            /*
             * Desktop WebView behaviour.
             */
            useWideViewPort = true;

            loadWithOverviewMode = true;


            /*
             * KEEP pinch zoom enabled.
             */
            builtInZoomControls = true;

            displayZoomControls = false;

            setSupportZoom(true);


            /*
             * Desktop Chrome UA prevents TW2
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
                        request
                            ?.url
                            ?.toString()
                            ?: return false


                    /*
                     * Don't let TW2 send us
                     * to Google Play.
                     */
                    if (
                        url.startsWith(
                            "intent://"
                        ) ||
                        url.startsWith(
                            "market://"
                        ) ||
                        url.contains(
                            "play.google.com/store/apps/details"
                        )
                    ) {

                        return true
                    }


                    return false
                }


                @Deprecated(
                    "Deprecated in Java"
                )
                override fun shouldOverrideUrlLoading(
                    view: WebView?,
                    url: String?
                ): Boolean {

                    if (
                        url != null &&
                        (
                            url.startsWith(
                                "intent://"
                            ) ||
                            url.startsWith(
                                "market://"
                            ) ||
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
                         * Keep our working TW2 viewport.
                         */
                        view?.evaluateJavascript(
                            viewportFix,
                            null
                        )


                        /*
                         * Keep working map dragging.
                         */
                        view?.evaluateJavascript(
                            touchMouseBridge,
                            null
                        )


                        /*
                         * FINAL CHANGE:
                         *
                         * Start the WebView further zoomed out.
                         *
                         * This does NOT disable pinch zoom.
                         */
                        view?.postDelayed(
                            {
                                view.setInitialScale(50)
                            },
                            3500
                        )
                    }
                }
            }


        if (
            savedInstanceState == null
        ) {

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


    @Deprecated(
        "Deprecated in Java"
    )
    override fun onBackPressed() {

        if (
            webView.canGoBack()
        ) {

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
