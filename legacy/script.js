document.addEventListener('DOMContentLoaded', function () {
  // Header solid on scroll
  const header = document.querySelector('.site-header');
  const onScroll = () => {
    if (window.scrollY > 40) header.classList.add('solid');
    else header.classList.remove('solid');
  };
  onScroll();
  window.addEventListener('scroll', onScroll);

  // Mobile menu
  const toggle = document.querySelector('.nav-toggle');
  const mobileMenu = document.querySelector('.mobile-menu');
  const closeBtn = document.querySelector('.mobile-menu .close-btn');
  if (toggle && mobileMenu) {
    toggle.addEventListener('click', () => mobileMenu.classList.add('open'));
    closeBtn.addEventListener('click', () => mobileMenu.classList.remove('open'));
    mobileMenu.querySelectorAll('a').forEach(a =>
      a.addEventListener('click', () => mobileMenu.classList.remove('open'))
    );
  }

  // FAQ accordion
  document.querySelectorAll('.faq-item').forEach(item => {
    const q = item.querySelector('.faq-q');
    q.addEventListener('click', () => {
      const isOpen = item.classList.contains('open');
      document.querySelectorAll('.faq-item').forEach(i => i.classList.remove('open'));
      if (!isOpen) item.classList.add('open');
    });
  });

  // Booking form submit -> build WhatsApp message
  const bookingForm = document.querySelector('#booking-form');
  if (bookingForm) {
    bookingForm.addEventListener('submit', function (e) {
      e.preventDefault();
      const name = document.querySelector('#f-name').value.trim();
      const phone = document.querySelector('#f-phone').value.trim();
      const date = document.querySelector('#f-date').value;
      const pkg = document.querySelector('#f-package').value;
      const location = document.querySelector('#f-location').value.trim();
      const msg = document.querySelector('#f-message').value.trim();

      const text = `আসসালামু আলাইকুম, আমি বুকিং করতে চাই।%0A%0A👤 নাম: ${encodeURIComponent(name)}%0A📱 ফোন: ${encodeURIComponent(phone)}%0A📅 তারিখ: ${encodeURIComponent(date)}%0A🎁 প্যাকেজ: ${encodeURIComponent(pkg)}%0A📍 লোকেশন: ${encodeURIComponent(location)}%0A📝 বার্তা: ${encodeURIComponent(msg || 'নেই')}`;

      const waNumber = '8801XXXXXXXXX'; // TODO: replace with real WhatsApp number
      window.open(`https://wa.me/${waNumber}?text=${text}`, '_blank');
    });
  }
});
