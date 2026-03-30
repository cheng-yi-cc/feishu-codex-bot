document.addEventListener('DOMContentLoaded', () => {
    // Reveal animations on scroll
    const sections = document.querySelectorAll('section');
    
    const revealSection = (entries, observer) => {
        const [entry] = entries;
        if (!entry.isIntersecting) return;
        
        entry.target.style.opacity = 1;
        entry.target.style.transform = 'translateY(0)';
        observer.unobserve(entry.target);
    };
    
    const sectionObserver = new IntersectionObserver(revealSection, {
        root: null,
        threshold: 0.15,
    });
    
    sections.forEach(sec => {
        if (!sec.classList.contains('hero')) {
            sec.style.opacity = 0;
            sec.style.transform = 'translateY(30px)';
            sec.style.transition = 'all 0.8s cubic-bezier(0.16, 1, 0.3, 1)';
            sectionObserver.observe(sec);
        }
    });

    // Glass effect adjustment on navbar based on scroll
    const navbar = document.querySelector('.navbar');
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            navbar.style.background = 'rgba(13, 15, 23, 0.9)';
            navbar.style.boxShadow = '0 10px 30px -10px rgba(0, 0, 0, 0.5)';
        } else {
            navbar.style.background = 'rgba(13, 15, 23, 0.8)';
            navbar.style.boxShadow = 'none';
        }
    });
});
