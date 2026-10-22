using System;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace HowlerWindow
{
    /// <summary>
    /// Códigos de salida (Howler los lee para decidir qué hacer):
    /// 0 = la persona cerró la ventana · 2 = argumentos no válidos · 3 = falta el motor WebView2 · 4 = el motor se cayó.
    /// </summary>
    internal static class Program
    {
        [DllImport("shell32.dll", SetLastError = true)]
        private static extern void SetCurrentProcessExplicitAppUserModelID([MarshalAs(UnmanagedType.LPWStr)] string appId);

        [STAThread]
        private static int Main(string[] args)
        {
            string url = null, data = null, title = "Howler";
            for (int i = 0; i < args.Length - 1; i++)
            {
                if (args[i] == "--url") url = args[i + 1];
                else if (args[i] == "--data") data = args[i + 1];
                else if (args[i] == "--title") title = args[i + 1];
            }
            // Solo se muestra el panel local: nada de abrir cualquier dirección con esta ventana.
            if (!Uri.TryCreate(url, UriKind.Absolute, out Uri start) || !IsLocal(start) || string.IsNullOrWhiteSpace(data)) return 2;

            try { SetCurrentProcessExplicitAppUserModelID("Howler.Panel"); } catch { /* sin él solo cambia el agrupado de la barra de tareas */ }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            var form = new PanelForm(start, data, title);
            Application.Run(form);
            return form.ExitCode;
        }

        internal static bool IsLocal(Uri u) =>
            (u.Scheme == Uri.UriSchemeHttp || u.Scheme == Uri.UriSchemeHttps) && (u.Host == "127.0.0.1" || u.Host == "localhost");

        /// <summary>Abre un enlace en el navegador de la persona. Solo http(s): nada de archivos ni programas.</summary>
        internal static void OpenExternal(string uri)
        {
            if (!Uri.TryCreate(uri, UriKind.Absolute, out Uri u)) return;
            if (u.Scheme != Uri.UriSchemeHttp && u.Scheme != Uri.UriSchemeHttps) return;
            try { Process.Start(new ProcessStartInfo(u.AbsoluteUri) { UseShellExecute = true }); } catch { /* sin navegador no hay nada que hacer */ }
        }
    }

    internal sealed class PanelForm : Form
    {
        private readonly Uri start;
        private readonly string dataDir;
        private readonly WebView2 web = new WebView2();
        private readonly string boundsFile;
        private readonly Timer themeTimer = new Timer { Interval = 1500 };
        private string lastTheme = "";

        [DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

        public int ExitCode { get; private set; }

        public PanelForm(Uri start, string dataDir, string title)
        {
            this.start = start;
            this.dataDir = dataDir;
            boundsFile = Path.Combine(dataDir, "window-bounds.txt");
            Text = title;
            BackColor = Color.FromArgb(18, 18, 18);
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { /* se queda el icono por defecto */ }
            MinimumSize = new Size(800, 560);
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(1320, 860);
            LoadBounds();

            web.Dock = DockStyle.Fill;
            web.DefaultBackgroundColor = Color.FromArgb(18, 18, 18);
            Controls.Add(web);
            Load += async (s, e) => await InitAsync();
            HandleCreated += (s, e) => ApplyChrome(Color.FromArgb(18, 18, 18), Color.FromArgb(235, 235, 235)); // el tema de serie es oscuro; se ajusta al tema real en cuanto carga
            FormClosing += (s, e) => { themeTimer.Stop(); SaveBounds(); };
            themeTimer.Tick += async (s, e) => await SyncThemeAsync();
        }

        private async System.Threading.Tasks.Task InitAsync()
        {
            try
            {
                Directory.CreateDirectory(dataDir);
                var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(dataDir, "webview"));
                await web.EnsureCoreWebView2Async(env);
            }
            catch (WebView2RuntimeNotFoundException) { Quit(3); return; }
            catch { Quit(4); return; }

            var core = web.CoreWebView2;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsGeneralAutofillEnabled = false;
            core.Settings.IsPasswordAutosaveEnabled = false;
            // Los enlaces que no son del panel (mods, Discord, GitHub…) se abren en el navegador, no dentro de esta ventana.
            core.NewWindowRequested += (s, e) => { e.Handled = true; Program.OpenExternal(e.Uri); };
            core.NavigationStarting += (s, e) =>
            {
                if (Uri.TryCreate(e.Uri, UriKind.Absolute, out Uri u) && !Program.IsLocal(u) && u.Scheme != "about" && u.Scheme != "data" && u.Scheme != "blob")
                {
                    e.Cancel = true;
                    Program.OpenExternal(e.Uri);
                }
            };
            core.ProcessFailed += (s, e) =>
            {
                if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited) Quit(4);
            };
            core.DocumentTitleChanged += (s, e) => { /* el título de la ventana es siempre «Howler» */ };
            web.Source = start;
            themeTimer.Start();
        }

        /// <summary>Lee los colores del tema de Howler que está activo en la página y pinta con ellos la barra de título y el borde de la ventana.</summary>
        private async System.Threading.Tasks.Task SyncThemeAsync()
        {
            try
            {
                if (web.CoreWebView2 == null) return;
                string raw = await web.CoreWebView2.ExecuteScriptAsync(
                    "(function(){var s=getComputedStyle(document.documentElement);return s.getPropertyValue('--bg').trim()+'|'+s.getPropertyValue('--text').trim();})()");
                string v = raw.Trim('"');
                if (v == lastTheme || v.Length < 3) return;
                var p = v.Split('|');
                if (p.Length != 2 || !TryColor(p[0], out Color bg) || !TryColor(p[1], out Color fg)) return;
                lastTheme = v;
                ApplyChrome(bg, fg);
            }
            catch { /* la página aún no ha cargado: se reintenta en el siguiente tic */ }
        }

        private static bool TryColor(string css, out Color c)
        {
            c = Color.Empty;
            var m = Regex.Match(css ?? "", @"^#([0-9a-fA-F]{6})$");
            if (m.Success)
            {
                int n = int.Parse(m.Groups[1].Value, NumberStyles.HexNumber, CultureInfo.InvariantCulture);
                c = Color.FromArgb((n >> 16) & 255, (n >> 8) & 255, n & 255);
                return true;
            }
            var r = Regex.Match(css ?? "", @"^rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)");
            if (r.Success)
            {
                c = Color.FromArgb(int.Parse(r.Groups[1].Value), int.Parse(r.Groups[2].Value), int.Parse(r.Groups[3].Value));
                return true;
            }
            return false;
        }

        /// <summary>
        /// Barra de título y borde con los colores del tema. El modo oscuro de la barra vale desde Windows 10 (1809); el color propio de la barra,
        /// del borde y del texto, solo desde Windows 11: en un Windows 10 la barra sigue el modo claro u oscuro pero sin el color exacto.
        /// </summary>
        private void ApplyChrome(Color bg, Color fg)
        {
            BackColor = bg;
            web.DefaultBackgroundColor = bg;
            if (!IsHandleCreated) return;
            bool dark = (0.299 * bg.R + 0.587 * bg.G + 0.114 * bg.B) < 140;
            int on = dark ? 1 : 0;
            if (DwmSetWindowAttribute(Handle, 20, ref on, 4) != 0) DwmSetWindowAttribute(Handle, 19, ref on, 4);
            int cap = bg.R | (bg.G << 8) | (bg.B << 16);
            int txt = fg.R | (fg.G << 8) | (fg.B << 16);
            DwmSetWindowAttribute(Handle, 35, ref cap, 4);  // color de la barra de título
            DwmSetWindowAttribute(Handle, 34, ref cap, 4);  // color del borde
            DwmSetWindowAttribute(Handle, 36, ref txt, 4);  // color del texto del título
        }

        private void Quit(int code)
        {
            ExitCode = code;
            Close();
        }

        private void LoadBounds()
        {
            try
            {
                if (!File.Exists(boundsFile)) return;
                var p = File.ReadAllText(boundsFile).Split(' ');
                if (p.Length < 5) return;
                var r = new Rectangle(int.Parse(p[0], CultureInfo.InvariantCulture), int.Parse(p[1], CultureInfo.InvariantCulture),
                                      int.Parse(p[2], CultureInfo.InvariantCulture), int.Parse(p[3], CultureInfo.InvariantCulture));
                // Solo si la ventana sigue cayendo dentro de alguna pantalla (por ejemplo, se quitó el segundo monitor).
                bool visible = false;
                foreach (var scr in Screen.AllScreens) if (scr.WorkingArea.IntersectsWith(r) && Rectangle.Intersect(scr.WorkingArea, r).Width > 120) visible = true;
                if (!visible || r.Width < 800 || r.Height < 560) return;
                StartPosition = FormStartPosition.Manual;
                Bounds = r;
                if (p[4] == "max") WindowState = FormWindowState.Maximized;
            }
            catch { /* archivo ilegible: se abre en el centro */ }
        }

        private void SaveBounds()
        {
            try
            {
                var r = WindowState == FormWindowState.Normal ? Bounds : RestoreBoundsOf();
                File.WriteAllText(boundsFile, string.Format(CultureInfo.InvariantCulture, "{0} {1} {2} {3} {4}", r.X, r.Y, r.Width, r.Height, WindowState == FormWindowState.Maximized ? "max" : "norm"));
            }
            catch { /* sin permiso de escritura: se abrirá en el centro la próxima vez */ }
        }

        private Rectangle RestoreBoundsOf() => base.RestoreBounds;
    }
}
