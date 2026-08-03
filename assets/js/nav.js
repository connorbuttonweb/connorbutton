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