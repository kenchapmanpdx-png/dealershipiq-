'use client';

// Animation engine for the marketing landing page. Ported verbatim from the
// approved standalone fork (GSAP + ScrollTrigger): hero entrance timeline,
// orb parallax, batched scroll reveals, steps-track line, metric count-ups,
// magnetic buttons, FAQ accordion, sticky CTA bar, smooth anchor scroll.
//
// Renders nothing — mount it once on the landing page. All listeners and
// triggers are cleaned up on unmount so client-side navigation to /signup
// and back doesn't stack duplicates.

import { useEffect } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

export default function MarketingFx() {
  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);
    const ac = new AbortController();
    const { signal } = ac;

    const ctx = gsap.context(() => {
      // ---- HERO ENTRANCE ----
      const heroTL = gsap.timeline({ defaults: { ease: 'power3.out' } });
      heroTL
        .to('.hero-eyebrow', { opacity: 1, y: 0, duration: 0.6 }, 0.2)
        .to(
          '.hero h1 .line-inner',
          { y: 0, duration: 0.9, stagger: 0.12, ease: 'power4.out' },
          0.3
        )
        .to('.hero-tagline', { opacity: 1, y: 0, duration: 0.7 }, '-=0.5')
        .to('.hero-sub', { opacity: 1, y: 0, duration: 0.7 }, '-=0.5')
        .to('.hero-cta', { opacity: 1, y: 0, duration: 0.6 }, '-=0.4')
        .to(
          '.phone-wrap',
          { opacity: 1, y: 0, x: 0, duration: 1.2, ease: 'power2.out' },
          '-=0.5'
        )
        .to(
          '.hero-promise',
          { opacity: 1, y: 0, duration: 0.6, stagger: 0.12, ease: 'power3.out' },
          '-=0.5'
        );

      // ---- HERO ORB PARALLAX ----
      const heroScrub = {
        trigger: '.hero',
        start: 'top top',
        end: 'bottom top',
        scrub: 0.5,
      } as const;
      gsap.to('.hero-orb-1', { y: -80, x: 30, scrollTrigger: heroScrub });
      gsap.to('.hero-orb-2', { y: -50, x: -20, scrollTrigger: heroScrub });
      gsap.to('.hero-orb-3', { y: -100, scrollTrigger: heroScrub });
      gsap.to('.hero-orb-4', { y: -60, x: 25, scrollTrigger: heroScrub });

      // ---- SCROLL REVEAL — staggered batch ----
      ScrollTrigger.batch('.sr', {
        onEnter: (batch) => {
          gsap.to(batch, {
            opacity: 1,
            y: 0,
            duration: 0.85,
            stagger: 0.08,
            ease: 'power3.out',
            overwrite: true,
          });
        },
        start: 'top 88%',
        once: true,
      });

      // ---- STEPS TRACK ----
      const stepsTrack = document.getElementById('stepsTrack');
      if (stepsTrack) {
        ScrollTrigger.create({
          trigger: stepsTrack,
          start: 'top 70%',
          once: true,
          onEnter: () => {
            stepsTrack.classList.add('active');
            // Stagger matched to the 2.8s line so each ring lights as the
            // line reaches it.
            gsap.utils.toArray<Element>('#stepsTrack .step').forEach((s, i) => {
              gsap.delayedCall(0.3 + i * 0.65, () => s.classList.add('lit'));
            });
          },
        });
      }

      // ---- METRICS COUNT-UP ----
      // "<5s" counts DOWN from 30 and "0 disruption" counts down from 9 —
      // the drop is the message. Static text is the reduced-motion fallback.
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        document.querySelectorAll<HTMLElement>('.m-num[data-end]').forEach((el) => {
          const startV = parseFloat(el.dataset.start ?? '0');
          const endV = parseFloat(el.dataset.end ?? '0');
          const prefix = el.dataset.prefix ?? '';
          const suffix = el.dataset.suffix ?? '';
          const obj = { v: startV };
          ScrollTrigger.create({
            trigger: el,
            start: 'top 88%',
            once: true,
            onEnter: () => {
              gsap.to(obj, {
                v: endV,
                duration: 1.8,
                ease: 'power2.out',
                onUpdate: () => {
                  el.textContent = prefix + Math.round(obj.v) + suffix;
                },
              });
            },
          });
        });
      }

      // ---- STICKY CTA BAR ----
      const stickyCta = document.getElementById('stickyCta');
      const signupSection = document.getElementById('signup');
      if (stickyCta) {
        ScrollTrigger.create({
          trigger: '.hero',
          start: 'bottom top',
          onEnter: () => stickyCta.classList.add('visible'),
          onLeaveBack: () => stickyCta.classList.remove('visible'),
        });
        if (signupSection) {
          ScrollTrigger.create({
            trigger: signupSection,
            start: 'top 80%',
            onEnter: () => stickyCta.classList.remove('visible'),
            onLeaveBack: () => stickyCta.classList.add('visible'),
          });
        }
      }
    });

    // ---- MAGNETIC BUTTONS ----
    document.querySelectorAll<HTMLElement>('.magnetic').forEach((btn) => {
      btn.addEventListener(
        'mousemove',
        (e: MouseEvent) => {
          const rect = btn.getBoundingClientRect();
          const x = (e.clientX - rect.left - rect.width / 2) * 0.2;
          const y = (e.clientY - rect.top - rect.height / 2) * 0.2;
          gsap.to(btn, { x, y, duration: 0.4, ease: 'power2.out' });
        },
        { signal }
      );
      btn.addEventListener(
        'mouseleave',
        () => {
          gsap.to(btn, { x: 0, y: 0, duration: 0.6, ease: 'elastic.out(1, 0.5)' });
        },
        { signal }
      );
    });

    // ---- FAQ ACCORDION ----
    document.querySelectorAll<HTMLElement>('.faq-q').forEach((btn) => {
      btn.addEventListener(
        'click',
        () => {
          const item = btn.parentElement;
          if (!item) return;
          document.querySelectorAll('.faq-item.open').forEach((openItem) => {
            if (openItem !== item) openItem.classList.remove('open');
          });
          item.classList.toggle('open');
        },
        { signal }
      );
    });

    // ---- SMOOTH ANCHOR SCROLL ----
    document.querySelectorAll<HTMLAnchorElement>('a[href^="#"], a[href^="/#"]').forEach((a) => {
      a.addEventListener(
        'click',
        (e) => {
          const href = a.getAttribute('href') ?? '';
          const id = href.replace('/#', '#');
          if (!id.startsWith('#')) return;
          const target = document.querySelector(id);
          if (target) {
            e.preventDefault();
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        },
        { signal }
      );
    });

    return () => {
      ac.abort();
      ctx.revert();
    };
  }, []);

  return null;
}
