using HAI.Rhino.Core.Edit;
using HAI.Rhino.Core.Protocol;
using Newtonsoft.Json.Linq;
using Xunit;

namespace HAI.Rhino.Core.Tests
{
    public class EditTests
    {
        private static readonly double[] MoveBy2m = { 1, 0, 0, 2000, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 };

        [Fact]
        public void ReadsAMoveAndADeleteFromTheBridge()
        {
            var move = Codec.Read(Golden.Read("bridge-edit-move.json"))!;
            Assert.Equal(Wire.Edit, move.Type);
            var request = move.As<EditRequest>()!;
            Assert.Equal(("edit-1", "Move", "transform"), (request.Id, request.Label, request.Op.Op));
            Assert.Equal(MoveBy2m, request.Op.Matrix);
            var delete = Codec.Read(Golden.Read("bridge-edit-delete.json"))!.As<EditRequest>()!;
            Assert.Equal("delete", delete.Op.Op);
            Assert.Equal(2, delete.Op.Ids.Count);
            Assert.Null(delete.Op.Matrix);
            Assert.Equal(Wire.Redo, Codec.Read(Golden.Read("bridge-redo.json"))!.Type);
        }

        [Fact]
        public void AnswersAnEditWithItsOutcome()
        {
            Golden.Json("message-edited.json", Codec.Write(Wire.Edited, new Edited { Id = "edit-1", Ok = true }, "message-1"));
            var failed = Codec.Write(
                Wire.Edited,
                new Edited { Id = "edit-2", Ok = false, Error = "There is no object a2 in Rhino any more." },
                "message-1");
            Golden.Json("message-edit-failed.json", failed);
            Assert.Equal("rhino", (string?)JObject.Parse(failed)["payload"]!["host"]);
        }

        [Fact]
        public void AMoveInMillimetresIsScaledToTheDocumentsUnits()
        {
            // A document in metres: 2000 mm is 2 m. The turn and scale part is the same in any unit.
            var m = EditMatrix.ToDocument(MoveBy2m, 0.001)!;
            Assert.Equal(2.0, m[3], 9);
            Assert.Equal(1.0, m[0]);
            Assert.Equal(0.0, m[7]);
            Assert.Equal(2000, MoveBy2m[3]); // the request is left as it was
        }

        [Fact]
        public void ARotationKeepsItsTurnAndScalesItsShift()
        {
            // 90 degrees about (1000, 0): x' = -y + 1000, y' = x - 1000.
            var turn = new double[] { 0, -1, 0, 1000, 1, 0, 0, -1000, 0, 0, 1, 0, 0, 0, 0, 1 };
            var m = EditMatrix.ToDocument(turn, 0.1)!; // centimetres
            Assert.Equal(new double[] { 0, -1, 0, 100, 1, 0, 0, -100, 0, 0, 1, 0, 0, 0, 0, 1 }, m);
        }

        [Theory]
        [InlineData(15)]
        [InlineData(17)]
        public void AMatrixThatIsNotSixteenNumbersIsRefused(int length)
        {
            Assert.Null(EditMatrix.ToDocument(new double[length], 1));
            Assert.Null(EditMatrix.ToDocument(null, 1));
        }

        [Fact]
        public void AMatrixWithANumberThatIsNotFiniteIsRefused()
        {
            var bad = (double[])MoveBy2m.Clone();
            bad[5] = double.NaN;
            Assert.Null(EditMatrix.ToDocument(bad, 1));
        }

        [Fact]
        public void AMoveOfNothingChangesNothing()
        {
            Assert.True(EditMatrix.IsIdentity(new double[] { 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 }));
            Assert.False(EditMatrix.IsIdentity(MoveBy2m));
        }
    }
}
