/**
 * Payflow Embed Script & Web Component
 *
 * Allows merchants to embed a subscription button or plan card on their website.
 * Opens the Payflow subscribe flow in a secure popup window.
 *
 * Privacy:
 * - 100% self-contained.
 * - Zero third-party dependencies, zero trackers, zero analytics.
 */

(function () {
  'use strict';

  var DEFAULT_APP_URL = 'https://mmm-pay.github.io/payflow-frontend';

  function detectAppUrl() {
    if (typeof document !== 'undefined' && document.currentScript) {
      try {
        var scriptSrc = document.currentScript.src;
        if (scriptSrc) {
          var url = new URL(scriptSrc);
          var path = url.pathname.replace(/\/embed\/[^/]+$/, '');
          return url.origin + path;
        }
      } catch {
        // Fall back to default
      }
    }
    return DEFAULT_APP_URL;
  }

  var appBaseUrl = detectAppUrl();

  function openSubscribePopup(planId, merchant, customAppUrl) {
    var baseUrl = (customAppUrl || appBaseUrl).replace(/\/+$/, '');
    var targetUrl = baseUrl + '/subscribe/?plan=' + encodeURIComponent(planId);
    if (merchant) {
      targetUrl += '&merchant=' + encodeURIComponent(merchant);
    }

    var width = 520;
    var height = 740;
    var left = Math.max(0, (window.screen.width - width) / 2);
    var top = Math.max(0, (window.screen.height - height) / 2);

    var features = [
      'width=' + width,
      'height=' + height,
      'top=' + top,
      'left=' + left,
      'resizable=yes',
      'scrollbars=yes',
      'status=no',
      'menubar=no',
      'toolbar=no',
      'location=no'
    ].join(',');

    var popup = window.open(targetUrl, 'payflow_subscribe_popup', features);
    if (!popup || popup.closed || typeof popup.closed === 'undefined') {
      window.open(targetUrl, '_blank', 'noopener,noreferrer');
    } else {
      popup.focus();
    }
  }

  var stylesInjected = false;
  function injectStyles() {
    if (stylesInjected || typeof document === 'undefined') return;
    stylesInjected = true;
    var style = document.createElement('style');
    style.textContent = `
      .payflow-card {
        display: inline-flex;
        flex-direction: column;
        gap: 0.75rem;
        padding: 1.25rem;
        border-radius: 0.75rem;
        border: 1px solid rgba(255, 255, 255, 0.15);
        background: #0f172a;
        color: #f8fafc;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        max-width: 320px;
        box-sizing: border-box;
      }
      .payflow-card[data-theme="light"] {
        background: #ffffff;
        color: #0f172a;
        border-color: #e2e8f0;
      }
      .payflow-title {
        font-size: 1.125rem;
        font-weight: 600;
        margin: 0;
      }
      .payflow-price {
        font-size: 1.5rem;
        font-weight: 700;
        line-height: 1.2;
      }
      .payflow-period {
        font-size: 0.875rem;
        font-weight: 400;
        color: #94a3b8;
      }
      .payflow-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        padding: 0.625rem 1.25rem;
        background: #06b6d4;
        color: #042f2e;
        font-weight: 600;
        font-size: 0.875rem;
        border: none;
        border-radius: 0.5rem;
        cursor: pointer;
        transition: background 0.15s ease-in-out, transform 0.1s ease-in-out;
        text-decoration: none;
        outline: none;
      }
      .payflow-btn:hover {
        background: #22d3ee;
      }
      .payflow-btn:active {
        transform: scale(0.98);
      }
      .payflow-btn:focus-visible {
        outline: 2px solid #38bdf8;
        outline-offset: 2px;
      }
    `;
    document.head.appendChild(style);
  }

  function renderCardNode(name, amount, period, theme, onSubscribe) {
    var card = document.createElement('div');
    card.className = 'payflow-card';
    if (theme) card.setAttribute('data-theme', theme);

    if (name) {
      var title = document.createElement('h3');
      title.className = 'payflow-title';
      title.textContent = name;
      card.appendChild(title);
    }

    if (amount) {
      var price = document.createElement('div');
      price.className = 'payflow-price';
      price.textContent = amount;
      if (period) {
        var span = document.createElement('span');
        span.className = 'payflow-period';
        span.textContent = ' / ' + period;
        price.appendChild(span);
      }
      card.appendChild(price);
    }

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'payflow-btn';
    btn.setAttribute('aria-label', 'Subscribe with Payflow');
    btn.textContent = 'Subscribe with Payflow';
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      onSubscribe();
    });
    card.appendChild(btn);

    return card;
  }

  function renderButtonNode(onSubscribe) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'payflow-btn';
    btn.setAttribute('aria-label', 'Subscribe with Payflow');
    btn.textContent = 'Subscribe with Payflow';
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      onSubscribe();
    });
    return btn;
  }

  if (typeof customElements !== 'undefined' && !customElements.get('payflow-button')) {
    class PayflowButtonElement extends HTMLElement {
      connectedCallback() {
        injectStyles();
        this.render();
      }

      static get observedAttributes() {
        return ['plan-id', 'merchant', 'name', 'amount', 'period', 'theme', 'app-url'];
      }

      attributeChangedCallback() {
        this.render();
      }

      render() {
        var planId = this.getAttribute('plan-id') || '1';
        var merchant = this.getAttribute('merchant') || '';
        var name = this.getAttribute('name');
        var amount = this.getAttribute('amount');
        var period = this.getAttribute('period');
        var theme = this.getAttribute('theme') || 'dark';
        var appUrl = this.getAttribute('app-url') || appBaseUrl;

        while (this.firstChild) {
          this.removeChild(this.firstChild);
        }

        var onSubscribe = function () {
          openSubscribePopup(planId, merchant, appUrl);
        };

        if (name || amount || period) {
          this.appendChild(renderCardNode(name, amount, period, theme, onSubscribe));
        } else {
          this.appendChild(renderButtonNode(onSubscribe));
        }
      }
    }

    customElements.define('payflow-button', PayflowButtonElement);
  }

  function hydrateDataAttributes() {
    if (typeof document === 'undefined') return;
    injectStyles();
    var targets = document.querySelectorAll('[data-payflow-plan-id]:not([data-payflow-ready])');
    targets.forEach(function (el) {
      el.setAttribute('data-payflow-ready', 'true');
      var planId = el.getAttribute('data-payflow-plan-id');
      var merchant = el.getAttribute('data-merchant') || '';
      var name = el.getAttribute('data-name');
      var amount = el.getAttribute('data-amount');
      var period = el.getAttribute('data-period');
      var appUrl = el.getAttribute('data-app-url') || appBaseUrl;

      while (el.firstChild) {
        el.removeChild(el.firstChild);
      }

      var onSubscribe = function () {
        openSubscribePopup(planId, merchant, appUrl);
      };

      el.appendChild(renderCardNode(name, amount, period, 'dark', onSubscribe));
    });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', hydrateDataAttributes);
    } else {
      hydrateDataAttributes();
    }
  }

  if (typeof window !== 'undefined') {
    window.PayflowEmbed = {
      openSubscribePopup: openSubscribePopup,
      detectAppUrl: detectAppUrl,
      appBaseUrl: appBaseUrl,
      hydrate: hydrateDataAttributes,
    };
  }
})();
