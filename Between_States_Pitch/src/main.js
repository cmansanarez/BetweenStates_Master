/* ==========================================================
   BETWEEN STATES — Main Script
   ==========================================================
   Sections:
   1. Hero canvas  — neon particle network + glitch slices
   2. Close canvas — XR grid pulse
   3. Scroll progress bar
   4. Reveal on scroll (IntersectionObserver)
   5. Funding bar animation (IntersectionObserver)
   6. Hero parallax fade
   ========================================================== */

import './style.css'

const PALETTE = ['#44FFD1', '#304FFE', '#FF1D89', '#FFEC00', '#BCF804', '#F58A07']

// ==========================================================
// 1. HERO CANVAS — neon particle network
// ==========================================================
function initHeroCanvas () {
  const canvas = document.querySelector('.hero-canvas')
  if (!canvas) return

  const ctx = canvas.getContext('2d')
  const COUNT = 65
  let W, H
  let particles = []

  const resize = () => {
    W = canvas.width  = canvas.offsetWidth
    H = canvas.height = canvas.offsetHeight
  }

  class Particle {
    constructor () { this.reset(true) }

    reset (anywhere = false) {
      this.x  = anywhere ? Math.random() * W : (Math.random() > 0.5 ? -10 : W + 10)
      this.y  = Math.random() * H
      this.vx = (Math.random() - 0.5) * 0.65
      this.vy = (Math.random() - 0.5) * 0.65
      this.r  = Math.random() * 1.6 + 0.7
      this.c  = PALETTE[Math.floor(Math.random() * PALETTE.length)]
      this.a  = Math.random() * 0.45 + 0.2
    }

    update () {
      this.x += this.vx
      this.y += this.vy
      if (this.x < -20 || this.x > W + 20 || this.y < -20 || this.y > H + 20) {
        this.reset()
      }
    }

    draw () {
      ctx.save()
      ctx.globalAlpha = this.a
      ctx.beginPath()
      ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2)
      ctx.fillStyle   = this.c
      ctx.shadowColor = this.c
      ctx.shadowBlur  = 10
      ctx.fill()
      ctx.restore()
    }
  }

  const buildParticles = () => {
    particles = Array.from({ length: COUNT }, () => new Particle())
  }

  const drawLinks = () => {
    const MAX = 130
    for (let i = 0; i < particles.length - 1; i++) {
      const pi = particles[i]
      for (let j = i + 1; j < particles.length; j++) {
        const pj = particles[j]
        const dx = pi.x - pj.x
        const dy = pi.y - pj.y
        const d  = Math.sqrt(dx * dx + dy * dy)
        if (d < MAX) {
          ctx.save()
          ctx.globalAlpha = (1 - d / MAX) * 0.18
          ctx.strokeStyle = pi.c
          ctx.lineWidth   = 0.55
          ctx.beginPath()
          ctx.moveTo(pi.x, pi.y)
          ctx.lineTo(pj.x, pj.y)
          ctx.stroke()
          ctx.restore()
        }
      }
    }
  }

  // Radial glow in center
  const drawCenterGlow = () => {
    const g = ctx.createRadialGradient(W * 0.5, H * 0.5, 0, W * 0.5, H * 0.5, Math.min(W, H) * 0.52)
    g.addColorStop(0, 'rgba(68,255,209,0.038)')
    g.addColorStop(1, 'transparent')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
  }

  // Occasional glitch: briefly shift horizontal canvas slices
  let glitchCd = 0
  let glitchFrames = 0

  const maybeGlitch = () => {
    if (glitchCd > 0) { glitchCd--; return }
    if (Math.random() > 0.994) {
      glitchCd    = 80 + Math.floor(Math.random() * 120)
      glitchFrames = 4 + Math.floor(Math.random() * 5)
    }

    if (glitchFrames > 0) {
      glitchFrames--
      const n = 2 + Math.floor(Math.random() * 4)
      for (let i = 0; i < n; i++) {
        const sy = Math.random() * H
        const sh = 3 + Math.random() * 10
        const ox = (Math.random() - 0.5) * 28
        ctx.save()
        ctx.drawImage(canvas, 0, sy, W, sh, ox, sy, W, sh)
        ctx.restore()
      }
    }
  }

  const animate = () => {
    ctx.clearRect(0, 0, W, H)
    drawCenterGlow()
    particles.forEach(p => p.update())
    drawLinks()
    particles.forEach(p => p.draw())
    maybeGlitch()
    requestAnimationFrame(animate)
  }

  resize()
  buildParticles()
  animate()
  window.addEventListener('resize', () => { resize(); buildParticles() })
}

// ==========================================================
// 2. CLOSE CANVAS — XR grid pulse
// ==========================================================
function initCloseCanvas () {
  const canvas = document.querySelector('.close-canvas')
  if (!canvas) return

  const ctx = canvas.getContext('2d')
  const COLS = ['#44FFD1', '#FF1D89', '#FFEC00', '#304FFE', '#BCF804']
  let W, H, t = 0

  const resize = () => {
    W = canvas.width  = canvas.offsetWidth
    H = canvas.height = canvas.offsetHeight
  }

  const animate = () => {
    ctx.clearRect(0, 0, W, H)

    const CELL = 38
    const cols = Math.ceil(W / CELL) + 1
    const rows = Math.ceil(H / CELL) + 1
    const cw   = W / cols
    const ch   = H / rows

    for (let x = 0; x < cols; x++) {
      for (let y = 0; y < rows; y++) {
        // Sinusoidal noise field
        const n = (Math.sin(x * 0.38 + t * 0.014) * Math.cos(y * 0.32 + t * 0.011) + 1) * 0.5
        if (n > 0.60) {
          const alpha = Math.min((n - 0.60) * 2.6, 0.75)
          const ci    = (x * 3 + y * 2 + Math.floor(t * 0.04)) % COLS.length
          ctx.save()
          ctx.globalAlpha = alpha
          ctx.fillStyle   = COLS[ci]
          ctx.shadowColor = COLS[ci]
          ctx.shadowBlur  = 5
          ctx.fillRect(x * cw + 1, y * ch + 1, cw - 2, ch - 2)
          ctx.restore()
        }
      }
    }

    // Draw grid lines faintly
    ctx.save()
    ctx.strokeStyle = 'rgba(68,255,209,0.06)'
    ctx.lineWidth   = 0.5
    for (let x = 0; x <= cols; x++) {
      ctx.beginPath(); ctx.moveTo(x * cw, 0); ctx.lineTo(x * cw, H); ctx.stroke()
    }
    for (let y = 0; y <= rows; y++) {
      ctx.beginPath(); ctx.moveTo(0, y * ch); ctx.lineTo(W, y * ch); ctx.stroke()
    }
    ctx.restore()

    t++
    requestAnimationFrame(animate)
  }

  resize()
  animate()
  window.addEventListener('resize', resize)
}

// ==========================================================
// 3. SCROLL PROGRESS
// ==========================================================
function initScrollProgress () {
  const bar = document.querySelector('.scroll-progress')
  if (!bar) return

  window.addEventListener('scroll', () => {
    const scrolled = window.scrollY
    const total    = document.documentElement.scrollHeight - window.innerHeight
    bar.style.width = total > 0 ? ((scrolled / total) * 100).toFixed(2) + '%' : '0%'
  }, { passive: true })
}

// ==========================================================
// 4. REVEAL ON SCROLL
// ==========================================================
function initReveal () {
  const items = document.querySelectorAll('.reveal')
  if (!items.length) return

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible')
        observer.unobserve(entry.target)
      }
    })
  }, { threshold: 0.1, rootMargin: '0px 0px -60px 0px' })

  items.forEach(el => observer.observe(el))
}

// ==========================================================
// 5. FUNDING BARS
// ==========================================================
function initFundingBars () {
  const fills = document.querySelectorAll('.funding-fill')
  if (!fills.length) return

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.width = entry.target.dataset.pct + '%'
        observer.unobserve(entry.target)
      }
    })
  }, { threshold: 0.5 })

  fills.forEach(el => observer.observe(el))
}

// ==========================================================
// 6. HERO PARALLAX FADE
// ==========================================================
function initParallax () {
  const content = document.querySelector('.hero-content')
  if (!content) return

  const hero   = document.querySelector('.hero')
  const getH   = () => hero.offsetHeight

  window.addEventListener('scroll', () => {
    const y = window.scrollY
    const h = getH()
    if (y < h) {
      const t = y / h
      content.style.transform = `translateY(${(y * 0.22).toFixed(1)}px)`
      content.style.opacity   = Math.max(0, 1 - t * 1.8).toFixed(3)
    }
  }, { passive: true })
}

// ==========================================================
// INIT
// ==========================================================
document.addEventListener('DOMContentLoaded', () => {
  initScrollProgress()
  initReveal()
  initFundingBars()
  initParallax()
  initHeroCanvas()
  initCloseCanvas()
})
