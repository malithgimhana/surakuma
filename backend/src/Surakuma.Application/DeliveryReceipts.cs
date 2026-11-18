using Surakuma.Domain;

namespace Surakuma.Application;

public static class DeliveryReceipts
{
    public static DeliveryConfirmation Create(DeliveryInput? input, decimal dispatchedQuantity, string unit,
        DateTimeOffset dispatchedAt, string actorId, bool transfer = false)
    {
        if (input is null || string.IsNullOrWhiteSpace(input.Reference) || string.IsNullOrWhiteSpace(input.ReceivedBy))
            throw new RuleException("Enter the delivery reference and receiving representative.");
        if (input.Method != "ReceivingStaff" && (transfer || input.ConfirmedQuantity == 0 || input.Method != "RecipientAcknowledgment"))
            throw new RuleException("Choose an authorized confirmation method.");
        var now = DateTimeOffset.UtcNow;
        var receivedAt = input.ReceivedAt ?? now;
        if (receivedAt < dispatchedAt || receivedAt > now)
            throw new RuleException("Enter the actual receipt time between dispatch and now.");
        QuantityUnits.ValidateInventory(input.ConfirmedQuantity, unit);
        if (input.ConfirmedQuantity > dispatchedQuantity)
            throw new RuleException("Confirmed quantity may not exceed the dispatched quantity.");
        if (input.ConfirmedQuantity < dispatchedQuantity && string.IsNullOrWhiteSpace(input.ExceptionDetail))
            throw new RuleException("Explain the difference between the dispatched and received quantities.");
        return new DeliveryConfirmation
        {
            Reference = input.Reference.Trim(), ConfirmedQuantity = input.ConfirmedQuantity, ReceivedAt = receivedAt,
            ReceivedBy = input.ReceivedBy.Trim(), Method = input.Method, ActorId = actorId,
            Note = input.Note?.Trim() ?? "", ExceptionDetail = input.ExceptionDetail?.Trim() ?? "",
        };
    }
}
