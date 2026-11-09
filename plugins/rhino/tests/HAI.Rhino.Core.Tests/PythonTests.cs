using System;
using System.Linq;
using HAI.Rhino.Core.Python;
using Xunit;

namespace HAI.Rhino.Core.Tests
{
    public class PythonRequirementsTests
    {
        [Fact]
        public void APackageIsListedForApproval()
        {
            var found = PythonRequirements.Parse("# r: ladybug-core, numpy==2.1\nimport numpy\n");
            Assert.Equal(new[] { "ladybug-core", "numpy==2.1" }, found.Packages.ToArray());
            Assert.Empty(found.Invalid);
        }

        [Fact]
        public void LinesAnywhereInTheScriptCountAndDuplicatesAreListedOnce()
        {
            var found = PythonRequirements.Parse("#r:numpy\nprint(1)\r\n  # R: numpy, shapely>=2\n");
            Assert.Equal(new[] { "numpy", "shapely>=2" }, found.Packages.ToArray());
        }

        [Theory]
        [InlineData("--index-url https://evil.example")]
        [InlineData("-e .")]
        [InlineData("https://evil.example/pkg.zip")]
        [InlineData("../local")]
        [InlineData("numpy numpy")]
        public void WhatIsNotAPackageIsReportedNotInstalled(string spec)
        {
            var found = PythonRequirements.Parse("# r: " + spec);
            Assert.Empty(found.Packages);
            Assert.NotEmpty(found.Invalid);
        }

        [Fact]
        public void OnlyRequirementCommentsCount()
        {
            var found = PythonRequirements.Parse("# requirement: numpy\nx = 1  # r: numpy\n\"\"\"# r: numpy\"\"\"");
            Assert.Empty(found.Packages);
        }

        [Theory]
        [InlineData("numpy", true)]
        [InlineData("numpy==2.1.0", true)]
        [InlineData("shapely[vectorized]>=2", true)]
        [InlineData("a", true)]
        [InlineData("", false)]
        [InlineData("-numpy", false)]
        [InlineData("numpy==", false)]
        public void PackageSpecsAreCheckedLikeTheBridgeChecksThem(string spec, bool valid)
        {
            Assert.Equal(valid, PythonRequirements.IsPackageSpec(spec));
        }

        [Fact]
        public void ASpecOver100CharactersIsRefused()
        {
            Assert.False(PythonRequirements.IsPackageSpec(new string('a', 101)));
            Assert.True(PythonRequirements.IsPackageSpec(new string('a', 100)));
        }
    }

    public class PythonResultShaperTests
    {
        [Fact]
        public void OutputIsCapped()
        {
            var text = new string('a', 15_000) + new string('b', 15_000);
            var capped = PythonResultShaper.Cap(text);
            Assert.StartsWith(new string('a', 10_000), capped);
            Assert.EndsWith(new string('b', 10_000), capped);
            Assert.Contains("\n[... 10000 characters left out ...]\n", capped);
            Assert.True(capped.Length < 20_100);
        }

        [Fact]
        public void ShortOutputIsUntouched()
        {
            Assert.Equal("hello", PythonResultShaper.Cap("hello"));
            var exact = new string('x', 20_000);
            Assert.Equal(exact, PythonResultShaper.Cap(exact));
        }

        [Fact]
        public void OutputAndResultComeBack()
        {
            var result = PythonResultShaper.Finished("run-1", "added 3 objects\r\n", "{\"count\": 3}", TimeSpan.FromMilliseconds(250));
            Assert.True(result.Ok);
            Assert.Equal("run-1", result.Id);
            Assert.Equal("added 3 objects\n", result.Stdout);
            Assert.Equal("{\"count\": 3}", result.Result);
            Assert.Null(result.Error);
            Assert.Equal(250, result.DurationMs);
        }

        [Fact]
        public void NoResultVariableMeansNoResult()
        {
            Assert.Null(PythonResultShaper.Finished("r", "", null, TimeSpan.Zero).Result);
            Assert.Null(PythonResultShaper.Finished("r", "", "", TimeSpan.Zero).Result);
        }

        [Fact]
        public void AnErrorKeepsTheEndOfTheTraceback()
        {
            var lines = Enumerable.Range(1, 40).Select(n => "  line " + n).Append("NameError: name x is not defined");
            var failed = PythonResultShaper.Failed("run-2", "partial\n", string.Join("\r\n", lines), TimeSpan.FromSeconds(1));
            Assert.False(failed.Ok);
            Assert.Equal("partial\n", failed.Stdout);
            var kept = failed.Error!.Split('\n');
            Assert.Equal(PythonResultShaper.TracebackLines, kept.Length);
            Assert.Equal("NameError: name x is not defined", kept[kept.Length - 1]);
            Assert.Equal("  line 30", kept[0]);
            Assert.Null(failed.Result);
        }

        [Fact]
        public void ALongErrorStaysUnderWhatTheBridgeAccepts()
        {
            var failed = PythonResultShaper.Failed("r", "", new string('e', 50_000), TimeSpan.Zero);
            Assert.True(failed.Error!.Length <= 10_000, "the bridge refuses an error over 10 000 characters");
        }
    }

    public class PythonWrapperTests
    {
        private static readonly string[] NoPackages = new string[0];

        [Fact]
        public void TheWrapperIsTheOneTheContractTestRuns() =>
            Golden.Text("python-wrapper.py", PythonWrapper.Compose(NoPackages, "CODE_PATH", "RESULT_PATH", 1000));

        [Fact]
        public void ItAsksRhinoForTheApprovedPackagesFirstAndNothingElse()
        {
            var lines = PythonWrapper.Compose(new[] { "numpy==2.1", "shapely" }, "c", "r", 1000).Split('\n');
            Assert.Equal("#! python 3", lines[0]);
            Assert.Equal("# r: numpy==2.1, shapely", lines[1]);
            Assert.Single(lines, line => line.StartsWith("# r:", StringComparison.Ordinal));
        }

        [Fact]
        public void WithoutPackagesThereIsNoRequirementLine() =>
            Assert.DoesNotContain("# r:", PythonWrapper.Compose(NoPackages, "c", "r", 1000));

        [Fact]
        public void APathIsAPythonStringWhateverItHolds()
        {
            var text = PythonWrapper.Compose(NoPackages, "C:\\a b\\\"code\".py", "r", 1000);
            Assert.Contains("_hai_run(\"C:\\\\a b\\\\\\\"code\\\".py\", \"r\", 1)", text);
        }

        [Fact]
        public void TheTimeLimitIsInSecondsWhateverTheLanguageOfTheMachine() =>
            Assert.EndsWith(", 2.5)\n", PythonWrapper.Compose(NoPackages, "c", "r", 2500));

        [Fact]
        public void AFinishedRunGivesItsOutputAndResult()
        {
            var answer = PythonWrapper.Answer("r", "{\"stdout\":\"hi\\r\\n\",\"result\":\"2\",\"error\":null}", "", TimeSpan.Zero);
            Assert.True(answer.Ok);
            Assert.Equal("hi\n", answer.Stdout);
            Assert.Equal("2", answer.Result);
        }

        [Fact]
        public void AFailedRunGivesItsOutputAndError()
        {
            var answer = PythonWrapper.Answer("r", "{\"stdout\":\"so far\",\"result\":null,\"error\":\"ValueError: no\"}", "", TimeSpan.Zero);
            Assert.False(answer.Ok);
            Assert.Equal("so far", answer.Stdout);
            Assert.Equal("ValueError: no", answer.Error);
        }

        [Theory]
        [InlineData(null)]
        [InlineData("")]
        [InlineData("not json")]
        public void WithoutAnAnswerWhatRhinoPrintedIsTheError(string? written)
        {
            var answer = PythonWrapper.Answer("r", written, " Could not install numpy\n", TimeSpan.Zero);
            Assert.False(answer.Ok);
            Assert.Equal("Could not install numpy", answer.Error);
        }

        [Fact]
        public void WithNothingAtAllItStillSaysSo() =>
            Assert.Equal("Rhino did not run the script.", PythonWrapper.Answer("r", null, "", TimeSpan.Zero).Error);
    }
}
