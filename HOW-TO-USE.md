# Rojey POS 2.5: how to use

Rojey POS 2.5 is a till program for Windows. It has its own database, so it keeps working when there is no internet. It sends everything to your website (pos.rojeycreamery.com) by itself when the internet is back. Nothing on the website needs to change.

## Files

| File | What it is |
|---|---|
| `RojeyPOS-Setup-2.5.0.exe` | Installer. Adds a desktop and Start menu shortcut and an uninstaller (Settings > Apps > Rojey POS). Use this on each till. |
| `RojeyPOS-Portable-2.5.0.exe` | Runs without installing, e.g. from a USB stick. It uses the same data as the installed copy. |
| `rojey-pos-v2-source.zip` | Source code. |

Installing 2.5 over any earlier version keeps your settings. Any orders that 1.x had not uploaded yet are uploaded by 2.5. **From 2.5 on, new versions install by themselves** (see *Updates*), so this is the last time you need to run the installer by hand.

## First time (needs internet once)

1. Open Rojey POS. The **Settings** screen opens.
2. Type the website address (`pos.rojeycreamery.com`) and click **Check**.
3. Pick the printers (see **Printers** below). Use **Test print** to check each one.
4. Click **Save**, then sign in with an email and password or a PIN. The app downloads the menu, prices, taxes, modifiers, kitchens, tables, waiters, customers and payment methods from the website.

The app also tries to match each kitchen to a Windows printer with the same name as the printer set on the website.

## Printers

Settings > **2. Printers** has one box for each place that prints:

- **Cashier: receipts and bills.** The receipt printer.
- **One box for each kitchen on the website**, for example **Kitchen** and **Cafe**. Each box appears by itself after the first sign-in, however many kitchens the website has. Pick the Windows printer for that kitchen. Each item on an order prints at its own kitchen the moment the order is placed.
- **Add another printer for …** puts a second (or third) printer in a kitchen's box. The same ticket then prints on each of them. The red **×** removes it.
- **Any other kitchen (default KOT printer).** Used for a kitchen that has no printer chosen.

The blue **Where things print** list underneath says in plain words where each ticket will go, and changes as you pick printers. Click **Save** when done.

## When a ticket does not print

If a KOT, receipt, bill or test print fails, a red **Printing failed** box appears at the top right with a short beep. It says which ticket, which printer and why (for example *offline*, *out of paper*, *jammed*, *not found*). It stays on screen until you close it.

- Fix the printer (switch it on, connect it, add paper), then press **Print again**.
- When Windows says the printer is offline, Windows usually keeps the ticket and prints it when the printer comes back. Press **Print again** only if it never comes out, so the kitchen does not get it twice.
- Every failure is also written to `rojey-pos.log`.

## Updates

New versions are published on GitHub (github.com/DERRO12/rojey-desktop, under *Releases*). Each till checks about every 30 minutes and downloads a new version in the background. The download is checked, so a broken download is never installed.

- The update **installs by itself** when nobody is signed in on the till, or when the app is closed. The app opens again on its own. Orders, settings and sign-ins are kept.
- **Admins** also see an **update button** (arrow-up icon) at the top of the POS screen. It has a green dot when a new version is ready. Click it to install now, or to check for a new version.
- To turn off automatic downloads, untick *Download new versions by themselves* in Settings > Updates.
- The portable copy does not update itself. Use the Setup file on tills.

## Taxes

Taxes (VAT) are **off** by default, so bills and receipts show no tax lines.

- An admin turns them on in **Settings > Taxes**, and ticks each tax to use (for example VAT). Taxes that are not ticked, such as CGST and SGST, are never added and never show on the bill.
- When an admin switches taxes on or off on the website, every till follows by itself within about 30 seconds.

## Customers

- The **customer box** next to the waiter: click it and type a name or a phone number to find a customer.
- **New** adds a customer (name, phone, email, delivery address). The pencil edits one. These follow the website permissions *Add Customer* and *Edit Customer*.
- A new customer is saved on this computer at once and on the website as soon as there is internet. Their orders wait until the website has the customer, so nothing is mixed up.
- A **Delivery** order needs a customer: the customer box opens by itself if none is chosen. The receipt shows the customer's phone number and delivery address.

## Giving an order to someone else

When the person who took an order signs out, or another waiter takes over a table:

1. Double-click the order.
2. Press **Assign to…**.
3. Pick the person; you can type to search.

A waiter becomes the order's waiter; anyone else becomes the person in charge of it. Tick *Also the other … orders* to move all of that person's running orders at once. The website gets the change straight away.

## Screen size

- **Ctrl +** makes everything bigger, **Ctrl −** smaller, and **Ctrl 0** goes back to normal, as in a browser. **Ctrl + mouse wheel** works too.
- The size is remembered for next time.
- On the first start, a very large screen starts a bit bigger by itself.
- The screen fits itself to the window, from a small 800 × 540 screen up to large monitors, so all buttons stay visible.

## Signing in

- **Email & Password** or **PIN** (the 4-digit login PIN set on the website). The PIN signs in as soon as the 4th digit is typed.
- With internet, the website checks the sign-in, so a new or changed password or PIN works at once.
- With no internet, anyone who has signed in on this till before can sign in again with the same password or PIN. A person who has never signed in on this till needs internet the first time.

## Selling

The screen is laid out like the website POS:

- **Left:** running orders and the order buttons (Modify Order, Order Details, KOT reprint, Invoice, Bill, Cancel Order).
- **Middle:** the cart.
- **Right:** the menu.

Actions:

- **Waiter:** the waiter box lists only people whose role on the website is *Waiter*. Click it and type part of a name to find the waiter; **Enter** picks the first match.
- **Place Order:** a **waiter** must be chosen first, and a **Dine In** order needs a **table** (the table screen opens by itself if none is chosen). It saves the order as running. The **KOT prints straight away**, and each item goes to its own kitchen's printer. If you later add items and press **Update Order**, only the new items print.
- **Direct Invoice:** takes the payment (more than one payment method is allowed, and change is worked out) and prints the receipt. Any items the kitchen has not had yet also print as KOT.
- **Bill:** prints a bill and keeps the order running.
- **KOT (left side):** reprints. It asks which items to reprint and marks them "(REPRINT)".
- **Table, Waiter, Customer** and **%** (discount, service charge, tips) work as on the website.
- Typing in the search box and pressing **Enter** adds the item when only one item matches.
- **Search orders** (top of the running orders, or **F4**): type an order number, table, waiter or customer. **Enter** picks the first order found; **Esc** or the **×** clears the search.
- **Print last invoice** (printer icon at the top, or **F8**) prints the last paid sale again. It works only when the person's role has *Print Last Invoice* on the website.

## Running orders on the left

- Each card shows the **table** (or Take Away / Delivery) and the **waiter** at the top, then the order number, customer and total, so you can scroll and read them quickly.
- **Double-click** a card to see the order details: the items, the total and the kitchen tickets (KOT) printed for it, with buttons to modify or invoice it.
- **Everyone signed in on this till sees every running order**, whoever placed it. A waiter can only change their own orders.
- An order leaves the list only when it is paid (here, on the website or on another till) or cancelled. It never disappears because a different person signs in. Orders placed on the website by someone else show here once a **cashier** has signed in on this till at least once, because on the website only cashiers can see everyone's running orders.

## Tables

The **Table** button opens the same table screen as the website. It shows:

- The areas on the left, and the floor plan and table pictures exactly as drawn on the website.
- A busy table in the website's "ordered" colours, with the table name, the waiter and the order number.

How to use it:

- Tap a **free table** to use it for the order in the cart.
- Tap a **busy table** to pick its order, or press **New order on …** to start another order on the same table. The box on the left shows its order number, waiter and total. Then press **Invoice**, **Modify Order**, **Bill** or **Cancel Order**. A double-tap on a busy table opens its order straight away.
- **Reset Table** takes the table off the current order.

Running orders on the left are listed **newest first**. Each one shows its order number, table, order type, customer, waiter, time and total. An order placed in the last two minutes has a green mark.

## Permissions (same as the website)

Each person gets the POS permissions of their role on the website. The website's role names for them are:

- Place Order
- Direct Invoice
- Invoice
- Bill
- Cancel Order
- Modify Order
- Discount
- Charge
- Tips
- Remove items already sent to the kitchen
- KOT
- Print Last Invoice

An action the role does not have is refused with a message. Admins can do everything.

**Waiter** accounts work as on the website:

- They cannot take payment, print bills or KOT, or cancel orders.
- They are always the waiter on their own orders.
- They see only their own running orders.

Their orders still print in the kitchen from this till.

Permission changes made on the website (for example taking away *Print Last Invoice*) reach the till by themselves within about 30 seconds while it is online, and at the latest at the next sign-in. The till keeps the last permissions it got, so the same rules apply offline.

## Internet and uploading

The status button at the top shows **Online** or **Offline**, plus the number of orders still waiting to upload.

- Paid sales are uploaded within a few seconds. Each sale is uploaded under the cashier who took it. If the register is closed on the website, the app opens it by itself (opening balance 0). You can turn this off in Settings.
- With no internet, sales are saved on this computer for as long as needed (days if necessary). They upload by themselves when the internet comes back. Closing the app or restarting the computer does not lose them.
- An order is never uploaded twice. The website matches orders by order number.
- **Running orders** are shared with the website, so other tills and the kitchen screen see them. Orders placed on other tills or on the website appear on this till within about 3 seconds, and the table screen updates too. **An order changed on the website or another till updates here too**, including orders that were placed on this till. An order paid or cancelled elsewhere disappears from this till.
- **Website changes** (menu, prices, tables and floor plans, users, permissions, payment methods) arrive by themselves within about 30 seconds, with nothing to click. The cloud icon fetches them at once.
- **Everything is kept on this computer**: every order, payment and a copy of every kitchen ticket (KOT). Once the website has confirmed an uploaded order, it and its KOT copies are cleared after the number of days set in Settings (**12 days** by default). Running orders and orders still waiting to upload are never cleared.
- The two buttons at the top right do this now: the red one gets running orders, and the green one uploads.

## If the website address changes or the site is down

- While the website is down, keep selling. Everything waits on the till.
- If the address changes, an admin opens **Settings** (gear icon, or Ctrl+,), types the new address and clicks **Save**. Waiting orders then upload to the new address. The menu and users download from the new address the next time someone signs in with internet, or when you click the cloud icon (download now).

## Admin only

- **Settings** (gear icon / Ctrl+,)
- **Sales on this computer** (list icon / F3): filter by date and 24-hour time (for example 08:00 to 21:30), or use the Today, Last 24 hours and All buttons. It shows the totals, what is waiting to upload, and a **Reprint** link for each sale.

## Keys

| Key | Action |
|---|---|
| F2 | POS |
| F3 | Sales (admin) |
| F9 | Sync now |
| F5 | Reload |
| F4 | Search running orders |
| F8 | Print last invoice |
| F11 | Full screen |
| Ctrl + / Ctrl − / Ctrl 0 | Bigger / smaller / normal size |
| Ctrl+Q | Quit |
| Ctrl+, | Settings (admin) |

The sign-out icon (top left) signs out at once. Closing the window closes the app at once, and nothing waiting is lost.

## Data folder

Settings > **Open the data folder** shows these files:

- `rojey-pos.db`: the database
- `rojey-pos.log`: the log, useful if something does not upload
- `config.json`: settings
- `secure.bin`: saved sign-ins, encrypted by Windows

When uninstalling, it asks whether to delete this folder too; the default answer No keeps it. Only delete it when the status button shows nothing waiting to upload.

---
Designed by Derrick Mugooba · Mauzo Books · 0755933629
