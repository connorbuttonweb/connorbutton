/* ==========================================================
   SITE NAVIGATION — single source of truth for every page.
   Edit the nav here and the change lands on all pages.

   Each page carries only <div id="site-nav"></div> as a
   placeholder; the markup below replaces it.
   ========================================================== */
const NAV_HTML = `
    <nav class="navbar">
        <div class="nav-container">
            <div class="nav-logo">
                <span class="logo-icon"></span>
                <a href="/" class="logo-text">CONNOR BUTTON</a>
            </div>

            <button class="mobile-toggle" aria-label="Open navigation">
                <span class="bar"></span>
                <span class="bar"></span>
                <span class="bar"></span>
            </button>

            <ul class="nav-menu">
                <li><a href="/" class="nav-link" id="nav-home">HOME</a></li>
                <li><a href="/#about" class="nav-link" id="nav-about">ABOUT</a></li>
                <li><a href="/assets/documents/Connor Button Resume.pdf" class="nav-link" target="_blank" id="nav-resume">RESUME</a></li>
                <li class="dropdown">
                    <a href="/portfolios/" class="nav-link" id="nav-portfolios">PORTFOLIOS <i class="fas fa-chevron-down"></i></a>
                    <ul class="dropdown-menu">
                        <li><a href="/pines/">Pines Landscaping</a></li>
                        <li><a href="/wallstreetprep/">Wall Street Prep</a></li>
                        <li><a href="/website/">Website Build</a></li>
                        <li><a href="/hyrox/">HYROX</a></li>
                        <li><a href="/documents/">Documents</a></li>
                    </ul>
                </li>
            </ul>

            <div class="nav-right">
                <a href="/contact/" class="contact-btn">Contact Me</a>
            </div>
        </div>
    </nav>`;

// Inject immediately (not on DOMContentLoaded) so that .navbar exists
// for any script loaded after this one — ticker.js on /search/ measures
// it to position the stock ticker bar.
const navMount = document.getElementById('site-nav');
if (navMount) navMount.outerHTML = NAV_HTML;

document.addEventListener('DOMContentLoaded', () => {
    const mobileBtn = document.querySelector('.mobile-toggle');
    const navMenu = document.querySelector('.nav-menu');

    // Only run if the elements actually exist on this page
    if (mobileBtn && navMenu) {
        
        // 1. Toggle menu when the hamburger button is clicked
        mobileBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevents the "click outside" listener from firing immediately
            navMenu.classList.toggle('active');
            mobileBtn.classList.toggle('is-open');
        });

        // 2. Close menu when any link inside it is clicked
        navMenu.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                navMenu.classList.remove('active');
                mobileBtn.classList.remove('is-open');
            });
        });

        // 3. Close menu when clicking anywhere outside the menu
        document.addEventListener('click', (e) => {
            if (!navMenu.contains(e.target) && !mobileBtn.contains(e.target)) {
                navMenu.classList.remove('active');
                mobileBtn.classList.remove('is-open');
            }
        });
    }

    // Set active nav link based on current path
    const path = window.location.pathname;
    const navHome = document.getElementById('nav-home');
    const navPortfolios = document.getElementById('nav-portfolios');

    if (navHome && navPortfolios) {
        if (path === '/' || path === '/index.html') {
            navHome.classList.add('active');
        } else if (path.startsWith('/portfolios') || path.startsWith('/pines') || path.startsWith('/wallstreetprep') || path.startsWith('/website') || path.startsWith('/hyrox') || path.startsWith('/documents')) {
            navPortfolios.classList.add('active');
        }
    }
});