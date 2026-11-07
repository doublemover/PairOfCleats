using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace PairOfCleats.Tests {
  // Test-only visibility isolation. Never switches the user's input desktop.
  public sealed class PrivateDesktop : IDisposable {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct Startup {
      public int Size;
      public string Reserved, Desktop, Title;
      public uint X, Y, Width, Height, XChars, YChars, Fill, Flags;
      public ushort Show, ReservedSize;
      public IntPtr ReservedBytes, Input, Output, Error;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct Started {
      public IntPtr Process, Thread;
      public uint Pid, Tid;
    }
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateDesktopW(string name, IntPtr device, IntPtr mode, uint flags, uint access, IntPtr security);
    [DllImport("user32.dll", SetLastError = true)] static extern bool CloseDesktop(IntPtr desktop);
    [DllImport("user32.dll", SetLastError = true)] static extern bool SetThreadDesktop(IntPtr desktop);
    [DllImport("user32.dll")] static extern IntPtr GetThreadDesktop(uint thread);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern IntPtr GetProcessWindowStation();
    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool GetUserObjectInformationW(IntPtr handle, int index, StringBuilder output, int length, out int needed);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CreateProcessW(string executable, StringBuilder command, IntPtr processSecurity, IntPtr threadSecurity,
      bool inherit, uint flags, IntPtr environment, string directory, ref Startup startup, out Started started);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr handle, uint timeout);
    delegate bool EnumerateWindow(IntPtr window, IntPtr state);
    [DllImport("user32.dll", SetLastError = true)] static extern bool EnumDesktopWindows(IntPtr desktop, EnumerateWindow callback, IntPtr state);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateWindowExW(uint extended, string kind, string title, uint style, int x, int y, int width, int height,
      IntPtr parent, IntPtr menu, IntPtr instance, IntPtr parameter);
    [DllImport("user32.dll", SetLastError = true)] static extern bool DestroyWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);

    IntPtr desktop;
    readonly List<Process> processes = new List<Process>();
    readonly List<Exception> metadataFailures = new List<Exception>();
    static readonly HashSet<IntPtr> testWindows = new HashSet<IntPtr>();
    Exception disposalFailure;
    public string Name { get; private set; }
    public string Station { get; private set; }
    public string OriginalDesktop { get; private set; }
    public bool OriginalThreadRestored { get; private set; }
    public bool PrivateHandleClosed { get; private set; }
    static Exception NativeError(string action) { return new Win32Exception(Marshal.GetLastWin32Error(), action); }
    static string ObjectName(IntPtr handle) {
      var text = new StringBuilder(256); int needed;
      if (handle == IntPtr.Zero || !GetUserObjectInformationW(handle, 2, text, 512, out needed)) throw NativeError("Inspect desktop identity");
      return text.ToString();
    }
    public static string CurrentThreadDesktop { get { return ObjectName(GetThreadDesktop(GetCurrentThreadId())); } }
    public static string InputDesktop {
      get {
        var input = OpenInputDesktop(0, false, 1);
        if (input == IntPtr.Zero) throw NativeError("Inspect input desktop");
        try { return ObjectName(input); }
        finally { if (!CloseDesktop(input)) throw NativeError("Close input desktop observation"); }
      }
    }
    public PrivateDesktop() {
      Name = "PoCNative-" + Guid.NewGuid().ToString("N");
      Exception failure = null;
      var worker = new Thread(() => {
        var original = GetThreadDesktop(GetCurrentThreadId());
        try {
          Station = ObjectName(GetProcessWindowStation()); OriginalDesktop = ObjectName(original);
          desktop = CreateDesktopW(Name, IntPtr.Zero, IntPtr.Zero, 0, 0x01ff, IntPtr.Zero);
          if (desktop == IntPtr.Zero) throw NativeError("Create private qualification desktop");
          if (ObjectName(desktop) != Name || Name == OriginalDesktop) throw new InvalidOperationException("Private desktop identity mismatch.");
        } catch (Exception error) { failure = error; }
        finally {
          try {
            if (GetThreadDesktop(GetCurrentThreadId()) != original && !SetThreadDesktop(original)) throw NativeError("Restore original worker desktop");
            OriginalThreadRestored = CurrentThreadDesktop == OriginalDesktop;
          } catch (Exception cleanup) { failure = failure == null ? cleanup : new AggregateException(failure, cleanup); }
        }
      });
      worker.IsBackground = true; worker.Start();
      if (!worker.Join(5000)) throw new TimeoutException("Private desktop creation did not settle; no application was started.");
      if (failure != null || !OriginalThreadRestored) {
        var primary = failure ?? new InvalidOperationException("Original desktop restoration unconfirmed.");
        if (desktop != IntPtr.Zero && !CloseDesktop(desktop)) throw new AggregateException(primary, NativeError("Close refused desktop"));
        desktop = IntPtr.Zero; throw primary;
      }
    }
    static string Quote(string value) {
      if (value == null || value.IndexOf('\0') >= 0) throw new ArgumentException("Native arguments must be finite strings without NUL.");
      var text = new StringBuilder("\""); int slashes = 0;
      foreach (char ch in value) {
        if (ch == '\\') { slashes++; continue; }
        text.Append('\\', ch == '"' ? slashes * 2 + 1 : slashes); text.Append(ch); slashes = 0;
      }
      return text.Append('\\', slashes * 2).Append('"').ToString();
    }
    public Process Start(string executable, string[] arguments, string directory) {
      if (desktop == IntPtr.Zero || disposalFailure != null) throw new InvalidOperationException("Private desktop is unavailable; no default-desktop fallback.");
      if (!Path.IsPathFullyQualified(executable) || !File.Exists(executable) || !Directory.Exists(directory)) throw new ArgumentException("Native host paths must exist.");
      var command = new StringBuilder(Quote(executable)); foreach (var arg in arguments) command.Append(' ').Append(Quote(arg));
      if (command.Length >= 32767) throw new ArgumentException("Native command exceeds the Windows command-line limit.");
      var startup = new Startup { Size = Marshal.SizeOf(typeof(Startup)), Desktop = Station + "\\" + Name };
      Started native;
      if (!CreateProcessW(executable, command, IntPtr.Zero, IntPtr.Zero, false, 0x08000004, IntPtr.Zero, directory, ref startup, out native))
        throw NativeError("Create owned process on its private desktop");
      Process process = null;
      try {
        // Capture the managed process handle before its original thread runs.
        process = Process.GetProcessById((int)native.Pid); var captured = process.Handle; processes.Add(process);
        uint count = ResumeThread(native.Thread);
        if (count == uint.MaxValue) throw NativeError("Resume owned native process");
        if (count != 1) throw new InvalidOperationException("Original native thread did not become runnable.");
      } catch (Exception primary) {
        if (!TerminateProcess(native.Process, 1) || WaitForSingleObject(native.Process, 3000) != 0)
          throw new AggregateException(primary, NativeError("Settle failed native launch"));
        throw;
      } finally {
        if (!CloseHandle(native.Thread)) metadataFailures.Add(NativeError("Close original native thread handle"));
        if (!CloseHandle(native.Process)) metadataFailures.Add(NativeError("Close original native process handle"));
      }
      if (metadataFailures.Count != 0) throw new AggregateException("Native launch metadata closure unconfirmed.", metadataFailures);
      return process;
    }
    static int[] WindowProcesses(IntPtr selected) {
      var ids = new HashSet<int>(); bool overflow = false;
      bool complete = EnumDesktopWindows(selected, (window, state) => {
        uint pid; GetWindowThreadProcessId(window, out pid); if (pid != 0) ids.Add((int)pid);
        if (ids.Count > 1024) { overflow = true; return false; } return true;
      }, IntPtr.Zero);
      if (overflow) throw new InvalidOperationException("Desktop observation exceeded its bounded process inventory.");
      if (!complete) throw NativeError("Enumerate qualification desktop");
      var values = new int[ids.Count]; ids.CopyTo(values); return values;
    }
    public int[] WindowProcessIds() {
      if (desktop == IntPtr.Zero) throw new InvalidOperationException("Desktop already closed.");
      return WindowProcesses(desktop);
    }
    public static bool HasWindowOnInputDesktop(int pid) {
      var input = OpenInputDesktop(0, false, 0x0041);
      if (input == IntPtr.Zero) throw NativeError("Observe input-desktop ownership");
      try { return Array.IndexOf(WindowProcesses(input), pid) >= 0; }
      finally { if (!CloseDesktop(input)) throw NativeError("Close input-desktop ownership observation"); }
    }
    public static IntPtr CreateVisibleTestWindow(string expectedDesktop) {
      if (CurrentThreadDesktop != expectedDesktop || InputDesktop == expectedDesktop)
        throw new InvalidOperationException("No test window may be created on the user's input desktop.");
      var window = CreateWindowExW(0, "STATIC", "PairOfCleats owned isolation control", 0x10cf0000, 0, 0, 160, 80,
        IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
      if (window == IntPtr.Zero) throw NativeError("Create private test window");
      testWindows.Add(window); return window;
    }
    public static bool TestWindowIsVisible(IntPtr window) { return testWindows.Contains(window) && IsWindowVisible(window); }
    public static void DestroyTestWindow(IntPtr window) {
      if (!testWindows.Contains(window)) throw new InvalidOperationException("Unknown test window.");
      if (!DestroyWindow(window)) throw NativeError("Destroy original private test window"); testWindows.Remove(window);
    }
    public void Dispose() {
      if (disposalFailure != null) throw disposalFailure;
      if (PrivateHandleClosed) return;
      var errors = new List<Exception>(metadataFailures);
      foreach (var process in processes) {
        try {
          if (!process.HasExited) process.Kill(true);
          if (!process.WaitForExit(3000)) throw new TimeoutException("Original native process remains live.");
          process.Dispose();
        } catch (Exception error) { errors.Add(error); }
      }
      if (errors.Count == 0) {
        if (CloseDesktop(desktop)) { desktop = IntPtr.Zero; PrivateHandleClosed = true; }
        else errors.Add(NativeError("Close private desktop handle"));
      }
      if (errors.Count != 0) { disposalFailure = new AggregateException("Private desktop ownership remains unconfirmed.", errors); throw disposalFailure; }
    }
  }
}
