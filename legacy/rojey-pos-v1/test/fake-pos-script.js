(function () {
  // Minimal copy of the POS's offline KOT code path, including its original bugs, for testing the fixes.
  var $ = function (sel) { var el = document.querySelector(sel); return { attr: function (n, v) { if (v === undefined) return el && el.getAttribute(n); el.setAttribute(n, v); } }; };
  function checkInternetConnection() { return Number(document.getElementById('is_offline_system').value); }
  function getSelectedOrderDetails(sale_no_new) {
    return new Promise(function (resolve) {
      dbReady.then(function (db) {
        db.transaction(['sales']).objectStore('sales').openCursor().onsuccess = function (e) {
          var c = e.target.result; if (c) { if (c.value.sale_no == sale_no_new) { resolve(c.value.order); } c.continue(); }
        };
      });
    });
  }
  function print_kot_print(order_info, kot_print) {
    var order = JSON.parse(order_info);
    var p = window.open('', 'popup', 'width=100', 'height=600');
    p.document.write('<html><body><h3 class="kot-print-title">KOT: Main</h3><p>' + order.sale_no + '</p><script>setTimeout(function(){window.print()},1000)<\/script></body></html>');
    p.document.close();
    window.__kotPrinted = (window.__kotPrinted || 0) + 1;
  }
      function print_kot_button(kot_print){
        if(checkInternetConnection()){
            window.__kotModal = true; document.getElementById('kot_list_modal').classList.add('active');
        }else{
            let sale_no = $(".print_kot_button").attr("data-sale_id");
            getSelectedOrderDetails(sale_no).then(function(data){
                if(data.order !== null) {
                    print_kot_print(data.order,kot_print);
                }
            });
        }
      }
  function push_next_offline_sale(always_notify) {
    window.__pagePushed = (window.__pagePushed || 0) + 1;
    window.pushAll();
  }
  window.push_online = function () { push_next_offline_sale(false); };
  window.push_online_sync = function () { push_next_offline_sale(true); };
  document.addEventListener('click', function (e) {
    if (e.target.closest('.print_kot_button')) {
      $('.print_kot_button').attr('data-sale_no', document.querySelector('.single_order[data-selected=selected] .running_order_order_number').textContent);
      document.querySelector('.invoice_box_kot').classList.toggle('active');
    }
    var k = e.target.closest('.kot_btn_class');
    if (k) { print_kot_button(Number(k.getAttribute('data-type'))); }
  });
})();
